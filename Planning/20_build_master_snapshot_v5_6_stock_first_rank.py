# scripts/20_build_master_snapshot.py
#
# MASTER_SNAPSHOT_v5.2 [OK]
# - Stale data protection (delisted/halted trap)
# - Iterative spike cleaning (prevents "double-kill")
# - Wilder ADX (RMA) + safe DX handling
# - Wilder ATR (RMA) + optional ETF fallback proxy
# - Volume metrics for stock breakout confirmation
# - Market regime filter using a benchmark vs 200DMA (robust dropna)
# - Optional position scaling (adds) using positions_state.csv
# - Writes an outputs/weekly_action_card.md summary

import argparse
import json
import sys
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
import numpy as np
import pandas as pd
import yfinance as yf

# SQLite adapter
try:
    import db as _db
    _USE_SQLITE = _db.db_exists()
except ImportError:
    _db = None
    _USE_SQLITE = False

# System Hardening: ticker & stop validation
from ticker_validation import (
    validate_ticker_full,
    validate_bulk_download,
    print_validation_summary,
    ValidationResult,
)

VERSION = "MASTER_SNAPSHOT_v5_9_HEAT_BREADTH_FOLLOWER"

# ----------------------------
# Config Loading
# ----------------------------
def load_params_config(config_path: Path = None) -> dict:
    """Load parameters from config/params.json if available."""
    if config_path is None:
        config_path = Path(__file__).parent.parent / "config" / "params.json"
    if config_path.exists():
        try:
            return json.loads(config_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] Could not load params.json: {e}")
    return {}

def load_active_config() -> dict:
    """
    Load active_config.json - the SINGLE SOURCE OF TRUTH for profile settings.
    Returns dict with: profile, risk_per_trade, max_positions, max_open_risk, small_account_mode
    """
    config_path = Path(__file__).parent.parent / "config" / "active_config.json"
    defaults = {
        "profile": "Default (0.75% / 8 pos)",
        "risk_per_trade": 0.0075,
        "max_positions": 8,
        "max_open_risk": 0.07,
        "small_account_mode": False,
        "description": "Default conservative profile"
    }
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
            # Merge with defaults (config file values take precedence)
            merged = {**defaults, **data}
            print(f"[CONFIG] Loaded active_config.json: {merged.get('profile', 'Unknown')}")
            return merged
        except Exception as e:
            print(f"[WARN] Could not load active_config.json: {e}")
    else:
        print(f"[WARN] active_config.json not found at {config_path}, using defaults")
    return defaults

PARAMS_CONFIG = load_params_config()
ACTIVE_CONFIG = load_active_config()  # Single source of truth for profile settings


def restore_emojis_for_markdown(text: str) -> str:
    """
    Restore emojis in markdown output (files can handle Unicode, unlike Windows console).
    """
    replacements = {
        '[OK]': '✅',
        '[X]': '❌',
        '[!]': '⚠️',
        '[CFG]': '⚙️',
        '[CHART]': '📊',
        '[DN]': '📉',
        '[UP]': '📈',
        '[^]': '🚀',
        '[#1]': '🏆',
        '[*]': '🟢',
        '[SYNC]': '🔄',
        '[LOCK]': '🔒',
        '[SHIELD]': '🛡️',
        'TURTLEZZZ': '🐢💤',
        'ZZZ LAGGARD': '💤 LAGGARD',
        '->': '→',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text

# ----------------------------
# Configuration Constants
# ----------------------------
# Technical Analysis Periods
ADX_PERIOD = 14
ATR_PERIOD = 14
MA_50_PERIOD = 50
MA_200_PERIOD = 200
LOOKBACK_HIGH_20 = 20
LOOKBACK_HIGH_55 = 55
LOOKBACK_LOW_10 = 10
LOOKBACK_LOW_20 = 20
VOLATILITY_PERIOD = 20
VOLATILITY_MEDIAN_WINDOW = 20
MEDIAN_WINDOW_MIN = 25

# Data Validation Thresholds
MIN_LOOKBACK_DATA = 50
MIN_ATR_DATA = 35
MIN_MA_DATA = 210
MIN_BENCHMARK_DATA = 210
MIN_PRICE_HISTORY = 200
DATA_AGE_MAX_DAYS = 60

# Percentage Thresholds
ATR_ETF_THRESHOLD_PCT = 0.03  # 3% - suspicious for ETF
VOLATILITY_DEFAULT = 0.02
PRICE_MA200_THRESHOLD = 0.05  # 5% - near 200MA
EXTENSION_ATR_THRESHOLD = 0.5  # 50% of ATR

# Entry/Exit Signal Distances
# TUNED: DIST_READY raised from 1.0% to 2.0% to catch fast-moving breakouts
# (By the time you see signal + run script + place trade, fast movers like NVDA/SMCI
#  have often already moved 1.5% from breakout. 2% gives wider "buy zone".)
DIST_READY = 2.0  # <= 2% from high = READY (was 1.0%)
DIST_WATCH = 3.0  # <= 3% from high = WATCH
RANGE_POSITION_BOTTOM = 0.15  # <= 15% position = range setup
RANGE_POSITION_MID = 0.35  # <= 35% position = mid-range

# ADX Thresholds
ADX_TREND_THRESHOLD = 20
ADX_STRONG_TREND = 18

# ADX Direction Filter: require +DI > -DI (bullish directional movement)
ADX_DIRECTION_FILTER = True  # When True, skip entries where -DI > +DI

# ATR% Volatility Cap (gap-risk control for jumpy stocks)
# TUNED: Enabled with 8% cap for ALL sleeves (the "Sleep Well" filter)
# Rationale: A stock moving 8%+ per day is too volatile for 0.75% risk model
# The position size would be too small or the stop too wide to be safe
ATR_PCT_CAP_ALL = 0.08        # 8% hard cap for all stocks
ATR_PCT_CAP_HIGH_RISK = 0.07  # 7% cap for STOCK_HIGH_RISK (stricter)
ATR_PCT_CAP_ENABLED = True    # ENABLED - blocks overly volatile entries

# Position Scaling - Pyramiding adds (0 = disabled)
ADD_LIMIT = 2  # Max pyramid adds per position (0 = pyramiding disabled)

# Entry Buffer (kills fake breakouts) - FIXED 10% to match backtest
ATR_ENTRY_BUFFER_MULT = 0.10  # 10% fixed (matches backtest)

# Position Limits (warning only, not hard block)
# TUNED: Raised from 5 to 8 to support "numbers game" momentum strategy
# Laggard Purge will automatically cycle out underperformers
MAX_POSITIONS = 8              # Warn when exceeding this many positions (was 5)
MAX_POSITIONS_WARN_ENABLED = True

# Momentum Expansion (ENABLED - raises risk cap in strong trends)
# TUNED: Raised from 4% to 7% to allow 8 positions (8 x 0.75% = 6%)
# Math: 8 positions x 0.75% risk = 6% total risk, so cap must be > 6%
MAX_OPEN_RISK_BASE = 0.07      # 7% base cap (was 4% - too restrictive for 8 positions)
MAX_OPEN_RISK_EXPANSION = 0.085  # 8.5% expanded cap in strong trends (was 5.5%)
MAX_OPEN_RISK_EXPANSION_ENABLED = True  # ENABLED - auto-expand in favorable conditions
ADX_EXPANSION_THRESHOLD = 25   # ADX > 25 = strong trend triggers expansion

# Re-Entry Settings (allow re-entry after profitable exits)
REENTRY_ENABLED = True                 # Allow re-entries
REENTRY_MIN_PROFIT_R = 0.5             # Minimum profit (R) from last exit to allow re-entry
REENTRY_COOLDOWN_DAYS = 5              # Minimum days since exit before re-entry
REENTRY_REQUIRE_NEW_HIGH = True        # Require new 20d high for re-entry

# Super-Cluster Risk Caps (thematic concentration control)
# TUNED: Raised from 20% to 50% to allow heavy weight in leading sectors (e.g., Tech in bull run)
# This prevents "cap inversion" where position caps exceed cluster/super-cluster caps
MAX_SUPERCLUSTER_RISK_PCT = 0.50  # 50% max open risk in one super-cluster (was 20%)

# CHOP Regime Tightening (for stocks only)
CHOP_ATR_TIGHTENING_MULT = 1.5  # candidate_stop = max(candidate_stop, close - 1.5*ATR)

# =============================================================================
# MODULE 1: ADVANCED PROFIT PROTECTION (The "Breakeven" Trigger)
# =============================================================================
# Problem: Many trades hit STOP_HIT exit after being profitable.
# Solution: Move stop to breakeven at +1.5R, lock +1R profit at +3R.
#
# Math:
#   R = entry_price - initial_stop (your risk unit)
#   profit_R = (close - entry_price) / R
#
#   At +1.5R: active_stop = max(active_stop, entry_price) -> locks in breakeven
#   At +3R:   active_stop = max(active_stop, entry_price + 1R) -> locks +1R profit
#
# This prevents "round-trip" trades that go positive then stop out at a loss.
# =============================================================================
PROFIT_PROTECTION_ENABLED = True       # Master switch for profit protection
PROFIT_PROTECTION_LOCK_HALF_R_THRESHOLD = 2.5  # Lock +0.5R profit at +2.5R (intermediate tier)
PROFIT_PROTECTION_LOCK_1R_THRESHOLD = 3.0  # Lock +1R profit at +3R

# =============================================================================
# MODULE 2: MOMENTUM "EARLY BIRD" ENTRY
# =============================================================================
# Problem: ADX confirmation (ADX > 20, +DI > -DI) is laggy for fast movers.
# Solution: Allow "aggressive entry" for stocks showing strong momentum signals:
#   - Price in top 10% of 55-day range (close >= low_55 + 0.90*(high_55 - low_55))
#   - Volume Ratio > 1.5 (above-average volume confirms conviction)
#   - Market Regime = BULLISH (only in favorable conditions)
#
# This catches early movers before ADX confirms, reducing missed opportunities.
# Still respects all other risk gates (cluster caps, sleeve caps, etc.)
# =============================================================================
EARLY_BIRD_ENABLED = True              # Master switch for early bird entries
EARLY_BIRD_RANGE_THRESHOLD = 0.90      # Top 10% of 55-day range
EARLY_BIRD_VOLUME_RATIO_MIN = 1.5      # Minimum volume ratio for confirmation
EARLY_BIRD_ADX_MIN = 15                # Minimum ADX (must show SOME directional movement)

# =============================================================================
# MODULE 3: THE "LAGGARD" PURGE
# =============================================================================
# Problem: Positions held >10 days while in loss tie up capital.
# Solution: Flag these as ACTION: TRIM_LAGGARD so user can recycle capital.
#
# Logic:
#   - Position held >= LAGGARD_HOLDING_DAYS
#   - Currently in loss (close < entry_price) but NOT hitting stop yet
#   - Flag for user review (not auto-sell, just a suggestion)
#
# This is capital efficiency optimization, not risk management.
# User decides whether to trim and redeploy to higher-momentum candidates.
# =============================================================================
LAGGARD_PURGE_ENABLED = True           # Master switch for laggard detection
LAGGARD_HOLDING_DAYS = 10              # Days held before flagging as laggard
LAGGARD_MIN_LOSS_PCT = 2.0             # Minimum loss % to flag (loss_pct is positive when underwater)

# =============================================================================
# MODULE 4: TREND EFFICIENCY FILTER (The "Smoothness" Score)
# =============================================================================
# Problem: High ADX stocks can still be "choppy" (high volatility), triggering
#          stops even when direction is right. We want "smooth" trends.
#
# Solution: Calculate Trend Efficiency = Net Move / Total Path Traveled
#   - Net Move = close_today - close_20d_ago (absolute directional gain)
#   - Total Path = sum of |daily returns| over 20 days (total distance traveled)
#   - Efficiency = Net Move / Total Path (ranges 0 to 1)
#   
# An efficiency > 0.6 means the stock moved "in a straight line".
# An efficiency < 0.3 means it went up/down a lot but netted little gain.
#
# In ranking, we boost stocks with high efficiency (they are "clean" movers).
# =============================================================================
TREND_EFFICIENCY_ENABLED = True        # Master switch for efficiency filter
TREND_EFFICIENCY_LOOKBACK = 20         # Days for efficiency calculation
TREND_EFFICIENCY_BOOST_THRESHOLD = 0.45  # Efficiency above this gets rank boost (lowered from 0.6)
TREND_EFFICIENCY_PENALTY_THRESHOLD = 0.3  # Efficiency below this gets penalty

# =============================================================================
# TREND EFFICIENCY GATE (Quality Filter for READY Status)
# =============================================================================
# Problem: Low efficiency stocks (choppy price action) frequently whipsaw,
#          causing repeated small losses ("death by a thousand cuts").
#
# Solution: Block stocks with trend_efficiency < 30% from becoming READY.
#           They can still be WATCH but cannot trigger entries.
# =============================================================================
TREND_EFFICIENCY_GATE_ENABLED = True   # Master switch for efficiency gate
TREND_EFFICIENCY_MIN_FOR_READY = 0.30  # Minimum efficiency to become READY (30%)

# =============================================================================
# MODULE 5: CLIMAX TOP EXIT (Profit Harvesting)
# =============================================================================
# Problem: Trades hit +5R or +8R but eventually trail back to +2R at stop.
#          We leave the "meat" of parabolic moves on the table.
#
# Solution: Detect "blow-off top" conditions and exit into strength:
#   - Price > 25% above 20-day MA (extended/parabolic)
#   - Volume > 3x 20-day average (climax volume = institutions selling)
#
# When both conditions met, flag ACTION: EXIT_CLIMAX to sell into strength
# rather than waiting for the trend to break.
# =============================================================================
CLIMAX_EXIT_ENABLED = True             # Master switch for climax detection
CLIMAX_MA_EXTENSION_PCT = 0.18         # Price must be 18% above MA20 (was 25% - too high)
CLIMAX_VOLUME_MULT = 3.0               # Volume must be 3x average

# =============================================================================
# MODULE 6: RELATIVE STRENGTH RANKING (RS vs Benchmark)
# =============================================================================
# Problem: During market pullbacks, everything drops. But stocks that drop
#          least are future leaders when market turns. We're blind to this.
#
# Solution: Track 3-month relative strength vs benchmark (SPY/GSPC).
#   - RS = (stock_return_3m - benchmark_return_3m)
#   - Positive RS = outperforming benchmark
#   - When market flips from BEARISH to BULLISH, top 5 by RS get
#     flagged as PRIORITY_ENTRY (regardless of ADX).
#
# This catches "latent leaders" early in new uptrends.
# =============================================================================
RS_RANKING_ENABLED = True              # Master switch for RS ranking
RS_LOOKBACK_DAYS = 63                  # ~3 months for RS calculation
RS_PRIORITY_COUNT = 5                  # How many top RS stocks to flag

# =============================================================================
# MODULE 7: HEAT-MAP SWAP LOGIC (Cluster Quality Upgrade)
# =============================================================================
# Problem: Cluster at cap with 5 stocks - 2 superstars, 3 mediocre.
#          A new READY candidate with better momentum can't enter.
#
# Solution: If a cluster is at risk cap AND a new READY candidate appears
#           with higher momentum rank than an existing holding in same cluster,
#           flag the weakest holding as SWAP_FOR_LEADER.
#
# This forces continuous portfolio quality upgrades within clusters.
# =============================================================================
SWAP_LOGIC_ENABLED = True              # Master switch for swap suggestions


# =============================================================================
# MODULE 8: THE "HEAT CHECK" (Correlation Filter / Cluster Concentration)
# =============================================================================
# Problem: 8 positions that are all in the same cluster = 1 giant bet on that
#          sector (e.g., Semiconductors). Need to prevent over-concentration.
#
# Solution: If we already hold 3 stocks in the same Cluster, the 4th stock
#           in that cluster must have a Momentum Score (rank_score) at least
#           20% BETTER than the AVERAGE of the existing 3 holdings in cluster.
#           If not, it stays in WATCH (blocked from entry).
#
# This ensures we only add to a "hot" cluster if the new candidate is a
# genuine superstar, not just another mediocre name in a crowded sector.
# =============================================================================
HEAT_CHECK_ENABLED = True              # Master switch for cluster concentration check
HEAT_CHECK_CLUSTER_THRESHOLD = 3       # Number of positions in cluster before check activates
HEAT_CHECK_MOMENTUM_PREMIUM = 0.20     # New entry must be 20% better than avg


# =============================================================================
# MODULE 9: THE "FAST-FOLLOWER" RE-ENTRY
# =============================================================================
# Problem: Tight 10% ATR buffer and strict stops mean getting "shaken out"
#          of winners like NVDA right before they moon another 50%.
#
# Solution: If a stock was sold due to STOP_HIT within last 10 days, but has
#           now reclaimed its 20-day High AND Volume Ratio > 2.0, flag as
#           ACTION: RE_ENTRY_SQUEEZE. This allows quick re-entry into trends
#           that briefly flushed out weak hands but are resuming.
#
# Requires tracking exit_reason in positions_state.csv (STOP_HIT vs other)
# =============================================================================
FAST_FOLLOWER_ENABLED = True           # Master switch for fast-follower re-entry
FAST_FOLLOWER_LOOKBACK_DAYS = 10       # Days since stop-hit exit to consider re-entry
FAST_FOLLOWER_VOLUME_RATIO_MIN = 2.0   # Minimum volume ratio for squeeze confirmation
FAST_FOLLOWER_REQUIRE_NEW_HIGH = True  # Must reclaim 20-day high

# =============================================================================
# MODULE 11: SERIAL WHIPSAW KILL SWITCH
# =============================================================================
# Problem: Some stocks (like ALV) repeatedly trigger READY, get entered,
#          then stop out for a loss within days. Repeated pain on same ticker.
#
# Solution: Track stop-hit exits. If same stock triggers READY → stops out
#           twice within WHIPSAW_MEMORY_DAYS, block re-entry for WHIPSAW_PENALTY_DAYS.
#
# Requires tracking whipsaw_count and last_whipsaw_date in positions_state.csv
# =============================================================================
WHIPSAW_KILL_SWITCH_ENABLED = True     # Master switch for whipsaw protection
WHIPSAW_MEMORY_DAYS = 30               # Window to count stop-hit losses
WHIPSAW_PENALTY_DAYS = 60              # Block re-entry for this many days after 2nd whipsaw
WHIPSAW_TRIGGER_COUNT = 2              # Number of stop-hit losses to trigger penalty


# =============================================================================
# MODULE 10: THE "MARKET BREADTH" SAFETY VALVE
# =============================================================================
# Problem: Benchmark (SPY/VWRL) might be above 200DMA, but if only 5 stocks
#          carry the whole market (poor breadth), portfolio is at risk.
#
# Solution: Check market breadth - % of our UNIVERSE stocks above their 50DMA.
#           If < 40%, automatically reduce MAX_POSITIONS from 8 to 4.
#           This forces selectivity when underlying market health is weak.
#
# TIER 1 FIX: Uses OUR universe (from weekend scan) instead of S&P sample.
# =============================================================================
BREADTH_SAFETY_ENABLED = True          # Master switch for breadth safety valve
BREADTH_THRESHOLD_PCT = 0.40           # Below 40% = weak breadth, reduce exposure
BREADTH_REDUCED_MAX_POSITIONS = 4      # Reduced MAX_POSITIONS when breadth is weak
BREADTH_SAMPLE_SIZE = 50               # DEPRECATED: Now uses full universe
BREADTH_USE_UNIVERSE = True            # TIER 1: Use scanned universe instead of S&P sample

# =============================================================================
# TIER 1: MONDAY EXECUTION GUARD (Gap/Extension Filter)
# =============================================================================
# Problem: If Monday opens well above the entry_trigger, chasing the gap
#          leads to poor R:R and violates the breakout timing discipline.
#
# Solution: On weekend, compute extension vs trigger. If too extended,
#           flag as exec_guard_pass=False so Monday tab can skip.
#           Guard uses BOTH ATR-based and percentage-based thresholds.
# =============================================================================
EXEC_GUARD_ENABLED = True              # Master switch for Monday execution guard
EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER = 0.75  # Max ATR distance above trigger (default 0.75)
EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER = 0.03  # Max % above trigger (default 3%)

# =============================================================================
# TIER 1: PYRAMIDING CONTROL
# =============================================================================
# Explicitly enable/disable pyramiding. When disabled, no ADD signals.
# When enabled, uses configurable ATR-based add levels.
# Derived from ADD_LIMIT to prevent contradictions.
# =============================================================================
PYRAMIDING_ENABLED = (ADD_LIMIT > 0)   # Derived from ADD_LIMIT (no separate override)
PYRAMID_ADD_1_ATR = 0.5                # Add #1 at entry + 0.5*ATR
PYRAMID_ADD_2_ATR = 1.0                # Add #2 at entry + 1.0*ATR
PYRAMID_MAX_ADDS = 2                   # Maximum number of adds per position

# =============================================================================
# TIER 2: ADAPTIVE ATR ENTRY BUFFER
# =============================================================================
# Problem: Fixed 10% ATR buffer may be too tight for volatile stocks,
#          too wide for calm stocks.
#
# Solution: Optionally scale buffer based on ATR% (atr_14/close).
#           Higher ATR% stocks get smaller buffer (they move more),
#           Lower ATR% stocks get larger buffer (need more confirmation).
# =============================================================================
ATR_BUFFER_MODE = PARAMS_CONFIG.get("ATR_BUFFER_MODE", "adaptive")  # "fixed" or "adaptive" (TIER 2: default adaptive)
# TIER 2: Adaptive formula: buffer_mult = clamp(0.05, 0.20, 0.18 - 0.60*atr_pct)
ATR_BUFFER_ADAPTIVE_BASE = 0.08        # Base for adaptive formula
ATR_BUFFER_ADAPTIVE_K = 0.60           # Multiplier on atr_pct
ATR_BUFFER_MIN = 0.05                  # Minimum buffer mult
ATR_BUFFER_MAX = 0.20                  # Maximum buffer mult (raised from 0.15)

# =============================================================================
# TIER 2: BREAKEVEN PROTECTION CONDITIONS
# =============================================================================
# Problem: Early breakeven moves can prematurely exit trades.
# Solution: Add conditions before moving to breakeven.
# =============================================================================
BE_TRIGGER_R = PARAMS_CONFIG.get("BE_TRIGGER_R", 1.5)  # Profit (in R) at which stop moves to breakeven. Single source of truth.
BE_CONDITION_MODE = PARAMS_CONFIG.get("BE_CONDITION_MODE", "none")  # "none"|"trend_only"|"after_days"
BE_ADX_MIN = 20                        # For trend_only mode
MIN_HOLD_DAYS_FOR_BE = 5               # For after_days mode

# =============================================================================
# TIER 2: CLIMAX EXIT AS TIGHTEN/TRIM (NOT HARD SELL)
# =============================================================================
# Problem: Climax detection triggers EXIT, but climax tops can spike higher.
# Solution: Tighten stop or suggest trim, not mandatory sell.
# =============================================================================
CLIMAX_ACTION = PARAMS_CONFIG.get("CLIMAX_ACTION", "trim")  # "tighten_stop" or "trim" (TIER 2: default trim)
CLIMAX_ATR_TIGHTEN_MULT = 1.5          # For tighten_stop: new stop = close - 1.5*ATR
CLIMAX_TRIM_PCT = 0.50                 # For trim: suggest trimming 50% (TIER 2: was 25%)

# =============================================================================
# TIER 3: REGIME STABILITY (Prevents flicker)
# =============================================================================
# Problem: CHOP regime can flip on single-day touches of the band.
# Solution: Require N consecutive days in band before labeling CHOP.
# =============================================================================
REGIME_STABILITY_ENABLED = True        # Master switch
REGIME_STABILITY_DAYS = 3              # Days required inside band for CHOP


# ----------------------------
# Sanity Checks
# ----------------------------
def run_sanity_checks(args) -> list[str]:
    """
    Run 5 sanity checks on configuration and return list of warnings.
    """
    warnings = []
    
    # 1. CLI vs internal defaults disagreement
    if hasattr(args, 'max_open_risk_pct'):
        cli_risk = args.max_open_risk_pct
        if cli_risk != MAX_OPEN_RISK_BASE:
            warnings.append(
                f"[!] SANITY #1: CLI --max_open_risk_pct ({cli_risk:.1%}) differs from "
                f"internal MAX_OPEN_RISK_BASE ({MAX_OPEN_RISK_BASE:.1%}). "
                f"Effective base will be CLI value."
            )
    
    # 2. Threshold pairs: DIST_READY should be <= DIST_WATCH
    if DIST_READY > DIST_WATCH:
        warnings.append(
            f"[!] SANITY #2: DIST_READY ({DIST_READY}%) > DIST_WATCH ({DIST_WATCH}%) - "
            f"READY threshold should be tighter (smaller) than WATCH!"
        )
    
    # 3. Range position thresholds: BOTTOM should be < MID
    if RANGE_POSITION_BOTTOM >= RANGE_POSITION_MID:
        warnings.append(
            f"[!] SANITY #3: RANGE_POSITION_BOTTOM ({RANGE_POSITION_BOTTOM}) >= "
            f"RANGE_POSITION_MID ({RANGE_POSITION_MID}) - Bottom should be less than mid!"
        )
    
    # 4. Expansion should be >= base
    if MAX_OPEN_RISK_EXPANSION < MAX_OPEN_RISK_BASE:
        warnings.append(
            f"[!] SANITY #4: MAX_OPEN_RISK_EXPANSION ({MAX_OPEN_RISK_EXPANSION:.1%}) < "
            f"MAX_OPEN_RISK_BASE ({MAX_OPEN_RISK_BASE:.1%}) - Expansion should be >= base!"
        )
    
    # 5. Risk per trade should be reasonable fraction of max open risk
    if hasattr(args, 'risk_per_trade_pct'):
        rpt = args.risk_per_trade_pct
        mor = args.max_open_risk_pct if hasattr(args, 'max_open_risk_pct') else MAX_OPEN_RISK_BASE
        if rpt > mor:
            warnings.append(
                f"[!] SANITY #5: risk_per_trade ({rpt:.2%}) > max_open_risk ({mor:.1%}) - "
                f"Single trade risk exceeds total portfolio risk cap!"
            )
        elif rpt > mor * 0.5:
            warnings.append(
                f"[!] SANITY #5: risk_per_trade ({rpt:.2%}) is > 50% of max_open_risk ({mor:.1%}) - "
                f"Only 1-2 positions possible before hitting cap."
            )
    
    return warnings


def get_active_params_dict(args, cap_mode: str, position_count: int, 
                           MAX_POSITION_PCT_CORE: float, MAX_POSITION_PCT_HIGH_RISK: float,
                           MAX_SLEEVE_CORE: float, MAX_SLEEVE_HIGH_RISK: float, 
                           MAX_SLEEVE_ETF: float, effective_max_risk: float,
                           breadth_info: dict = None) -> dict:
    """
    Build a dictionary of all active parameters for logging and transparency.
    Includes ACTIVE_CONFIG profile info for audit trail.
    """
    params = {
        "version": VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        
        # CRITICAL: Profile info from active_config.json (single source of truth)
        "active_profile": ACTIVE_CONFIG.get("profile", "Unknown"),
        "active_profile_description": ACTIVE_CONFIG.get("description", ""),
        "small_account_mode": args.small_account_mode,
        
        # Risk Management
        "risk_per_trade_pct": args.risk_per_trade_pct,
        "max_open_risk_pct_cli": args.max_open_risk_pct,
        "max_open_risk_base": MAX_OPEN_RISK_BASE,
        "max_open_risk_expansion": MAX_OPEN_RISK_EXPANSION,
        "max_open_risk_expansion_enabled": MAX_OPEN_RISK_EXPANSION_ENABLED,
        "effective_max_open_risk_pct": effective_max_risk,
        
        # Dynamic Caps
        "position_count": position_count,
        "cap_mode": cap_mode,
        "max_position_pct_core": MAX_POSITION_PCT_CORE,
        "max_position_pct_high_risk": MAX_POSITION_PCT_HIGH_RISK,
        "max_sleeve_core": MAX_SLEEVE_CORE,
        "max_sleeve_high_risk": MAX_SLEEVE_HIGH_RISK,
        "max_sleeve_etf": MAX_SLEEVE_ETF,
        
        # Concentration Limits
        "max_cluster_pct": args.max_cluster_pct,
        "max_supercluster_pct": MAX_SUPERCLUSTER_RISK_PCT,
        "max_positions_warn": MAX_POSITIONS,
        
        # Signal Thresholds
        "dist_ready_pct": DIST_READY,
        "dist_watch_pct": DIST_WATCH,
        "adx_trend_threshold": ADX_TREND_THRESHOLD,
        "adx_strong_trend": ADX_STRONG_TREND,
        "adx_direction_filter": ADX_DIRECTION_FILTER,
        "adx_expansion_threshold": ADX_EXPANSION_THRESHOLD,
        
        # Entry/Exit
        "atr_entry_buffer_mult": ATR_ENTRY_BUFFER_MULT,
        "chop_atr_tightening_mult": CHOP_ATR_TIGHTENING_MULT,
        
        # Re-entry
        "reentry_enabled": REENTRY_ENABLED,
        "reentry_min_profit_r": REENTRY_MIN_PROFIT_R,
        "reentry_cooldown_days": REENTRY_COOLDOWN_DAYS,
        
        # Pyramiding
        "add_limit": ADD_LIMIT,
        
        # Laggard Purge
        "laggard_purge_enabled": LAGGARD_PURGE_ENABLED,
        "laggard_holding_days": LAGGARD_HOLDING_DAYS,
        "laggard_min_loss_pct": LAGGARD_MIN_LOSS_PCT,
        
        # Benchmarks
        "benchmark": args.benchmark,
        "benchmark2": args.benchmark2,
        "regime_band_pct": args.regime_band_pct,
        
        # MODULE 8: Heat Check
        "heat_check_enabled": HEAT_CHECK_ENABLED,
        "heat_check_cluster_threshold": HEAT_CHECK_CLUSTER_THRESHOLD,
        "heat_check_momentum_premium": HEAT_CHECK_MOMENTUM_PREMIUM,
        
        # MODULE 9: Fast-Follower Re-entry
        "fast_follower_enabled": FAST_FOLLOWER_ENABLED,
        "fast_follower_lookback_days": FAST_FOLLOWER_LOOKBACK_DAYS,
        "fast_follower_volume_min": FAST_FOLLOWER_VOLUME_RATIO_MIN,
        
        # MODULE 10: Market Breadth Safety Valve
        "breadth_safety_enabled": BREADTH_SAFETY_ENABLED,
        "breadth_threshold_pct": BREADTH_THRESHOLD_PCT,
        "breadth_reduced_positions": BREADTH_REDUCED_MAX_POSITIONS,
        
        # TIER 1: Pyramiding Control
        "pyramiding_enabled": PYRAMIDING_ENABLED,
        "pyramid_add_1_atr": PYRAMID_ADD_1_ATR,
        "pyramid_add_2_atr": PYRAMID_ADD_2_ATR,
        "pyramid_max_adds": PYRAMID_MAX_ADDS,
        
        # TIER 2: Adaptive ATR Entry Buffer
        "atr_buffer_mode": ATR_BUFFER_MODE,
        "atr_buffer_adaptive_base": ATR_BUFFER_ADAPTIVE_BASE,
        "atr_buffer_adaptive_k": ATR_BUFFER_ADAPTIVE_K,
        "atr_buffer_min": ATR_BUFFER_MIN,
        "atr_buffer_max": ATR_BUFFER_MAX,
        
        # TIER 2: Breakeven Protection
        "be_trigger_r": BE_TRIGGER_R,
        "be_condition_mode": BE_CONDITION_MODE,
        "be_adx_min": BE_ADX_MIN,
        "min_hold_days_for_be": MIN_HOLD_DAYS_FOR_BE,
        "profit_protection_breakeven_r": BE_TRIGGER_R,  # consolidated: was PROFIT_PROTECTION_BREAKEVEN_R
        "profit_protection_lock_1r_threshold": PROFIT_PROTECTION_LOCK_1R_THRESHOLD,
        
        # TIER 2: Climax Exit
        "climax_action": CLIMAX_ACTION,
        "climax_atr_tighten_mult": CLIMAX_ATR_TIGHTEN_MULT,
        "climax_trim_pct": CLIMAX_TRIM_PCT,
        
        # TIER 3: Regime Stability
        "regime_stability_enabled": REGIME_STABILITY_ENABLED,
        "regime_stability_days": REGIME_STABILITY_DAYS,
        
        # Trend Efficiency Gate (30% minimum for READY)
        "trend_efficiency_gate_enabled": TREND_EFFICIENCY_GATE_ENABLED,
        "trend_efficiency_min_for_ready": TREND_EFFICIENCY_MIN_FOR_READY,
        "trend_efficiency_boost_threshold": TREND_EFFICIENCY_BOOST_THRESHOLD,
        
        # MODULE 11: Whipsaw Kill Switch
        "whipsaw_kill_switch_enabled": WHIPSAW_KILL_SWITCH_ENABLED,
        "whipsaw_memory_days": WHIPSAW_MEMORY_DAYS,
        "whipsaw_penalty_days": WHIPSAW_PENALTY_DAYS,
        "whipsaw_trigger_count": WHIPSAW_TRIGGER_COUNT,
    }
    
    # Add live breadth info if available
    if breadth_info:
        params["market_breadth_pct"] = breadth_info.get("breadth_pct", np.nan)
        params["market_breadth_healthy"] = breadth_info.get("breadth_healthy", True)
        params["effective_max_positions"] = breadth_info.get("effective_max_positions", MAX_POSITIONS)
    
    return params


# ----------------------------
# IO Helpers
# ----------------------------

def read_list(path: Path) -> list[str]:
    if not path.exists():
        return []
    lines = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines()]
    tickers = [ln for ln in lines if ln and not ln.startswith("#")]
    seen, out = set(), []
    for t in tickers:
        t = t.strip()
        if t and t not in seen:
            out.append(t)
            seen.add(t)
    return out


def read_portfolio_csv(path: Path) -> list[str]:
    """
    Read a CSV portfolio file (e.g., manual_portfolio.csv) and extract just the ticker column.
    
    Expected CSV format: ticker,quantity,avg_cost,currency
    Lines starting with # are comments.
    
    Returns list of unique tickers.
    """
    if not path.exists():
        return []
    
    # If it's a .txt file, use read_list instead
    if path.suffix.lower() == ".txt":
        return read_list(path)
    
    try:
        # Read CSV, skip comment lines
        df = pd.read_csv(path, comment='#')
        
        # Look for a ticker column (case-insensitive)
        ticker_col = None
        for col in df.columns:
            if col.lower().strip() in ("ticker", "symbol", "ticker_yf"):
                ticker_col = col
                break
        
        if ticker_col is None:
            # No ticker column found - maybe it's a simple txt format after all
            return read_list(path)
        
        # Extract unique tickers
        tickers = df[ticker_col].dropna().astype(str).str.strip().tolist()
        seen, out = set(), []
        for t in tickers:
            t = t.strip()
            if t and t not in seen and not t.startswith("#"):
                out.append(t)
                seen.add(t)
        return out
    except Exception as e:
        print(f"[WARN] Could not parse portfolio CSV {path}: {e}")
        return []


def read_cluster_map(path: Path) -> dict[str, str]:
    """Optional mapping: ticker_yf -> cluster name.
    CSV format: ticker_yf,cluster
    If file missing, returns empty dict.
    """
    if not path.exists():
        return {}
    try:
        df = pd.read_csv(path)
        df = df.dropna(subset=["ticker_yf", "cluster"])
        return {str(r["ticker_yf"]).strip(): str(r["cluster"]).strip() for _, r in df.iterrows()}
    except Exception:
        return {}


def read_super_cluster_map(path: Path) -> dict[str, str]:
    """Optional mapping: ticker_yf -> super_cluster name.
    CSV format: ticker_yf,super_cluster
    Super-clusters group thematically correlated stocks (e.g., MEGA_TECH_AI, SEMIS, ENERGY).
    If file missing, returns empty dict.
    """
    if not path.exists():
        return {}
    try:
        df = pd.read_csv(path)
        df = df.dropna(subset=["ticker_yf", "super_cluster"])
        return {str(r["ticker_yf"]).strip(): str(r["super_cluster"]).strip() for _, r in df.iterrows()}
    except Exception:
        return {}


def assign_cluster(ticker_yf: str, sleeve: str, cluster_map: dict[str, str]) -> str:
    """Return a deterministic cluster label (for correlation caps).
    Priority:
      1) Explicit cluster_map entry
      2) Try to get sector from yfinance (fallback)
      3) Sleeve-based fallback
    """
    if ticker_yf in cluster_map:
        return cluster_map[ticker_yf]
    
    # No yfinance fallback — cluster_map.csv is the single source of truth.
    # If a ticker is missing, flag it loudly so the map gets updated.
    print(f"[ERROR] {ticker_yf}: not found in cluster_map.csv — assign a cluster before trading")
    
    if sleeve == "ETF_CORE":
        return "ETF_CORE"
    if sleeve == "HEDGE":
        return "HEDGE"  # HEDGE positions get their own cluster
    # default for stocks if not mapped
    return "STOCKS"


def read_ticker_map(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    df = pd.read_csv(path)
    m = {}
    for _, r in df.iterrows():
        a = str(r.get("ticker_t212", "")).strip()
        b = str(r.get("ticker_yf", "")).strip()
        if a and b:
            m[a.upper()] = b
    return m


def map_ticker(t: str, mapping: dict[str, str]) -> str:
    """
    Convert Trading212 instrument codes to Yahoo Finance tickers.
    
    Priority:
    1. Explicit mapping from ticker_map.csv
    2. Pattern-based normalization (US equities, LSE, etc.)
    3. Return as-is if no rule matches
    
    Examples:
      NVDA_US_EQ -> NVDA
      DVN_US_EQ  -> DVN
      LLOYl_EQ   -> LLOY.L
      AIAIL_EQ   -> AIAI.L
    """
    t = (t or "").strip().upper()
    if not t:
        return ""
    
    # 1. Check explicit mapping first
    if t in mapping:
        return mapping[t]
    
    # 2. Pattern-based normalization for T212 suffixes
    # US equities: <TICKER>_US_EQ -> bare ticker
    if t.endswith("_US_EQ"):
        return t.replace("_US_EQ", "").upper()
    
    # LSE equities with uppercase L: <TICKER>L_EQ -> <TICKER>.L
    if t.endswith("L_EQ"):
        base = t.replace("L_EQ", "").upper()
        return f"{base}.L"
    
    # Handle lowercase 'l' pattern from T212: LLOYl_EQ -> LLOY.L
    if "_EQ" in t:
        base = t.replace("_EQ", "")
        # Check for trailing 'L' indicating LSE
        if base.endswith("L"):
            base = base[:-1]
            return f"{base.upper()}.L"
        return base.upper()
    
    return t


def as_float(x) -> float:
    """Convert value to float, returns np.nan on failure."""
    try:
        return float(x)
    except Exception:
        return np.nan


def money_value_ccy(obj: dict, key: str) -> tuple[float, str | None]:
    """
    Extract money value and currency from nested dict structure.
    
    Handles either:
      - key: number
      - key: {"value": number, "currencyCode": "..."}
    
    Returns: (value_float, currency_code_or_None)
    """
    if not isinstance(obj, dict):
        return (np.nan, None)
    v = obj.get(key, np.nan)
    if isinstance(v, dict):
        val = v.get("value", v.get("amount", np.nan))
        ccy = v.get("currencyCode", v.get("currency", v.get("ccy", None)))
        return (as_float(val), str(ccy).upper() if ccy else None)
    return (as_float(v), None)


def load_t212_snapshot(snapshot_path: Path, tmap: dict[str, str]) -> dict:
    """
    Supports both snapshot schemas:
      - New schema (your example): account_summary / account_cash / walletImpact
      - Older schema: totalEquity.value / cash.value / averagePrice.value etc

    Returns:
      {
        "total_equity_gbp": float|nan,
        "cash_gbp": float|nan,
        "positions": {
          "<ticker_yf>": {
            "ticker_t212": str,
            "quantity": float,
            "avg_price": float,
            "current_price": float,
            "value_gbp": float
          }, ...
        }
      }
    """
    if not snapshot_path or not snapshot_path.exists():
        return {}

    try:
        data = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    # --- Equity + cash (support both schemas) ---
    # Your schema:
    total_equity = as_float(data.get("account_summary", {}).get("totalValue", np.nan))
    cash = as_float(data.get("account_cash", {}).get("free", np.nan))

    # Older schema fallback:
    if not np.isfinite(total_equity):
        total_equity, _ = money_value_ccy(data, "totalEquity")
    if not np.isfinite(cash):
        cash, _ = money_value_ccy(data, "cash")

    positions = {}
    held_yf = set()   # tickers we actually hold according to snapshot

    for pos in data.get("positions", []) or []:
        inst = pos.get("instrument", {}) or {}
        ticker_t212 = str(inst.get("ticker", "")).strip().upper()
        if not ticker_t212:
            continue

        ticker_yf = map_ticker(ticker_t212, tmap)

        qty = as_float(pos.get("quantity", 0))

        # Track held positions for holdings.txt refresh
        if qty > 0 and ticker_yf:
            held_yf.add(str(ticker_yf).upper().strip())

        # Your schema uses numeric fields:
        cur_price = as_float(pos.get("currentPrice", np.nan))
        avg_price = as_float(pos.get("averagePricePaid", np.nan))

        # Initialize currency variables
        cur_ccy = None
        avg_ccy = None

        # Older schema fallback:
        if not np.isfinite(cur_price):
            cur_price, cur_ccy = money_value_ccy(pos, "currentPrice")
        if not np.isfinite(avg_price):
            avg_price, avg_ccy = money_value_ccy(pos, "averagePrice")

        
        instrument_ccy = None
        # Prefer explicit money fields currency codes if present
        if cur_ccy:
            instrument_ccy = cur_ccy
        elif avg_ccy:
            instrument_ccy = avg_ccy
        # Some schemas may have instrument currency
        if not instrument_ccy:
            ic = inst.get("currencyCode", inst.get("currency", None))
            instrument_ccy = str(ic).upper() if ic else None
# Best GBP value source in your schema:
        value_gbp = as_float(pos.get("walletImpact", {}).get("currentValue", np.nan))

        # Fallback if walletImpact missing:
        if not np.isfinite(value_gbp):
            # If instrument currency is GBX/GBP, qty*price is at least consistent-ish
            value_gbp = qty * cur_price if (np.isfinite(qty) and np.isfinite(cur_price)) else np.nan

            # If prices are in GBX (pence), convert to GBP for consistency
            if instrument_ccy in ("GBX", "GBPENCE", "GBp"):
                value_gbp = value_gbp / 100.0 if np.isfinite(value_gbp) else value_gbp

        positions[ticker_yf] = {
            "ticker_t212": ticker_t212,
            "quantity": qty,
            "avg_price": avg_price,
            "current_price": cur_price,
            "value_gbp": value_gbp,
            "currency": instrument_ccy,
        }

    # --- Always refresh holdings.txt from snapshot (source of truth) ---
    try:
        holdings_path = Path("universes") / "holdings.txt"
        holdings_path.parent.mkdir(parents=True, exist_ok=True)
        holdings_path.write_text("\n".join(sorted(held_yf)) + "\n", encoding="utf-8")
        print(f"Wrote {len(held_yf)} holdings to: {holdings_path}")
    except Exception as e:
        print(f"[WARN] Could not write holdings.txt: {e}")

    return {"total_equity_gbp": total_equity, "cash_gbp": cash, "positions": positions}

def read_positions_state(path: Path) -> dict[str, dict]:
    """
    State file for position tracking (stateful stops + profit protection + scaling + re-entry).
    CSV columns: ticker, entry_price, initial_stop, active_stop, adds_taken, entry_date, last_exit_date, last_exit_profit_R
    
    - entry_price: price at which position was opened
    - initial_stop: the first stop level set at entry (used to calculate R)
    - active_stop: current stateful stop (only moves up, never down)
    - adds_taken: number of pyramid adds already executed
    - entry_date: date position was opened (TIER 3: for turnover tracking)
    - last_exit_date: date of last exit (for re-entry cooldown)
    - last_exit_profit_R: profit in R-multiples at last exit (positive = profitable)
    
    HANDLES: Duplicate keys (e.g., IWQU vs IWQU.L) - keeps first, warns on duplicates.
    """
    if not path.exists():
        return {}
    try:
        df = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return {}
    if df.empty:
        return {}
    
    # DEDUPLICATION: Handle IWQU vs IWQU.L duplicates
    if "ticker" in df.columns:
        df["ticker_upper"] = df["ticker"].astype(str).str.strip().str.upper()
        duplicates = df[df["ticker_upper"].duplicated(keep=False)]
        if not duplicates.empty:
            dup_tickers = duplicates["ticker_upper"].unique().tolist()
            print(f"[WARN] Duplicate state keys found: {dup_tickers}")
            print(f"       Keeping first occurrence, dropping {len(duplicates) - len(df.drop_duplicates(subset=['ticker_upper']))}")
            # Keep first occurrence of each unique ticker
            df = df.drop_duplicates(subset=["ticker_upper"], keep="first")
    
    out = {}
    for _, r in df.iterrows():
        t = str(r.get("ticker", "")).strip().upper()
        if not t:
            continue
        try:
            entry = float(r.get("entry_price", np.nan))
        except Exception:
            entry = np.nan
        try:
            initial_stop = float(r.get("initial_stop", np.nan))
        except Exception:
            initial_stop = np.nan
        try:
            active_stop = float(r.get("active_stop", np.nan))
        except Exception:
            active_stop = np.nan
        try:
            adds = int(r.get("adds_taken", 0))
        except Exception:
            adds = 0
        try:
            entry_date = str(r.get("entry_date", ""))
        except Exception:
            entry_date = ""
        try:
            last_exit_date = str(r.get("last_exit_date", ""))
        except Exception:
            last_exit_date = ""
        try:
            last_exit_profit_R = float(r.get("last_exit_profit_R", np.nan))
        except Exception:
            last_exit_profit_R = np.nan
        try:
            last_exit_reason = str(r.get("last_exit_reason", ""))
        except Exception:
            last_exit_reason = ""
        # Whipsaw tracking fields
        try:
            whipsaw_count = int(r.get("whipsaw_count", 0))
        except Exception:
            whipsaw_count = 0
        try:
            last_whipsaw_date = str(r.get("last_whipsaw_date", ""))
        except Exception:
            last_whipsaw_date = ""
        out[t] = {
            "entry_price": entry,
            "initial_stop": initial_stop,
            "active_stop": active_stop,
            "adds_taken": adds,
            "entry_date": entry_date,
            "last_exit_date": last_exit_date,
            "last_exit_profit_R": last_exit_profit_R,
            "last_exit_reason": last_exit_reason,
            "whipsaw_count": whipsaw_count,
            "last_whipsaw_date": last_whipsaw_date,
        }
    return out


def write_positions_state(path: Path, state: dict[str, dict]) -> None:
    """
    Persist positions state to CSV.
    Writes all positions that have valid entry_price OR exit history (for re-entry tracking).
    """
    rows = []
    for ticker, data in state.items():
        entry = data.get("entry_price", np.nan)
        last_exit = data.get("last_exit_date", "")
        # Write if currently held OR has exit history for re-entry tracking
        if not np.isfinite(entry) and not last_exit:
            continue
        rows.append({
            "ticker": ticker,
            "entry_price": entry if np.isfinite(entry) else "",
            "initial_stop": data.get("initial_stop", np.nan),
            "active_stop": data.get("active_stop", np.nan),
            "adds_taken": data.get("adds_taken", 0),
            "entry_date": data.get("entry_date", ""),
            "last_exit_date": last_exit,
            "last_exit_profit_R": data.get("last_exit_profit_R", np.nan),
            "last_exit_reason": data.get("last_exit_reason", ""),
            "whipsaw_count": data.get("whipsaw_count", 0),
            "last_whipsaw_date": data.get("last_whipsaw_date", ""),
        })
    df = pd.DataFrame(rows)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    # SQLite: persist positions state
    if _USE_SQLITE:
        try:
            _db.save_positions_state(state)
        except Exception as e:
            print(f"[DB] positions_state write failed: {e}")
    print(f"Wrote {len(rows)} position states to: {path}")


# ----------------------------
# TIER 3: Trades Log (Fill Sanity / Slippage Tracking)
# ----------------------------
TRADES_LOG_PATH = Path("outputs/trades_log.csv")

def log_trade(ticker: str, action: str, expected_price: float, expected_stop: float,
              actual_fill_price: float = np.nan, exec_guard_blocked: bool = False,
              notes: str = "") -> None:
    """
    TIER 3: Append trade data to trades_log.csv for slippage analysis.
    
    Called for:
    - BUY: when a new position is detected (transition from not-held to held)
    - SELL: when a held position is signaled to exit (SELL, STOP_HIT, TRIM)
    
    Columns:
    - date: ISO date of logging
    - ticker: instrument ticker
    - action: BUY, SELL, TRIM, STOP_HIT
    - expected_price: for BUY = entry_trigger, for SELL = close or stop
    - expected_stop: computed stop loss price (for BUY actions)
    - actual_fill_price: T212 avg_price from snapshot (user can update later)
    - slippage_pct: (actual - expected) / expected * 100
    - exec_guard_blocked: whether this was flagged by execution guard
    - notes: any additional context
    """
    slippage_pct = 0.0
    if expected_price > 0 and actual_fill_price > 0 and np.isfinite(actual_fill_price):
        slippage_pct = (actual_fill_price - expected_price) / expected_price * 100
    
    row = {
        "date": date.today().isoformat(),
        "ticker": ticker,
        "action": action,
        "expected_price": round(expected_price, 4) if np.isfinite(expected_price) else "",
        "expected_stop": round(expected_stop, 4) if np.isfinite(expected_stop) else "",
        "actual_fill_price": round(actual_fill_price, 4) if np.isfinite(actual_fill_price) else "",
        "slippage_pct": round(slippage_pct, 2) if slippage_pct != 0 else "",
        "exec_guard_blocked": exec_guard_blocked,
        "notes": notes,
    }
    
    # Append to CSV (create if not exists)
    TRADES_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    file_exists = TRADES_LOG_PATH.exists()
    with open(TRADES_LOG_PATH, "a", newline="", encoding="utf-8") as f:
        import csv
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)
    # SQLite: persist trade log entry
    if _USE_SQLITE:
        try:
            _db.save_trade_log_entry(row)
        except Exception as e:
            print(f"[DB] trade log write failed: {e}")
    
    print(f"[TRADES LOG] {action} {ticker}: expected {expected_price:.2f}" + 
          (f", filled {actual_fill_price:.2f} ({slippage_pct:+.2f}%)" if np.isfinite(actual_fill_price) else ""))


# Legacy alias for backwards compatibility
FILL_SANITY_LOG_PATH = TRADES_LOG_PATH

def log_fill_sanity(ticker: str, expected_trigger: float, expected_stop: float,
                    actual_fill_price: float, exec_guard_blocked: bool = False,
                    notes: str = "") -> None:
    """Legacy wrapper - use log_trade() for new code."""
    log_trade(ticker, "BUY", expected_trigger, expected_stop, actual_fill_price, exec_guard_blocked, notes)


# ----------------------------
# TIER 3: Turnover Monitor
# ----------------------------
def compute_turnover_stats(positions_state: dict[str, dict], lookback_days: int = 30) -> dict:
    """
    TIER 3: Compute turnover statistics from positions_state entry_date/exit_date fields.
    
    Returns:
    - trades_last_N_days: number of exits in the lookback window
    - avg_holding_days: average holding duration for closed positions
    - active_positions: count of currently held positions
    - oldest_position_days: days since oldest active entry
    """
    today = date.today()
    lookback_start = today - timedelta(days=lookback_days)
    
    trades_in_window = 0
    holding_days_list = []
    active_entry_dates = []
    
    for ticker, data in positions_state.items():
        entry_date_str = data.get("entry_date", "")
        exit_date_str = data.get("last_exit_date", "")
        entry_price = data.get("entry_price", np.nan)
        
        # Parse dates
        entry_date = None
        exit_date = None
        
        if entry_date_str:
            try:
                entry_date = date.fromisoformat(entry_date_str)
            except ValueError:
                pass
        
        if exit_date_str:
            try:
                exit_date = date.fromisoformat(exit_date_str)
            except ValueError:
                pass
        
        # Active position (has entry_price but no recent exit, or entry_date > last_exit_date)
        is_active = np.isfinite(entry_price) and (not exit_date or (entry_date and entry_date > exit_date))
        
        if is_active and entry_date:
            active_entry_dates.append(entry_date)
        
        # Count exits in lookback window
        if exit_date and exit_date >= lookback_start:
            trades_in_window += 1
            
            # Compute holding duration if we have entry date
            if entry_date and entry_date <= exit_date:
                holding_days_list.append((exit_date - entry_date).days)
    
    avg_holding = np.mean(holding_days_list) if holding_days_list else np.nan
    oldest_days = (today - min(active_entry_dates)).days if active_entry_dates else 0
    
    return {
        "trades_last_N_days": trades_in_window,
        "lookback_days": lookback_days,
        "avg_holding_days": round(avg_holding, 1) if np.isfinite(avg_holding) else None,
        "active_positions": len(active_entry_dates),
        "oldest_position_days": oldest_days,
    }


# ----------------------------
# Indicators
# ----------------------------

def wilder_rma(series: pd.Series, period: int) -> pd.Series:
    # Wilder smoothing == EMA(alpha=1/period)
    return series.ewm(alpha=1/period, adjust=False).mean()


def calculate_adx(df: pd.DataFrame, period: int = ADX_PERIOD) -> tuple[pd.Series, pd.Series, pd.Series]:
    """
    Calculate ADX with directional indicators.
    
    Returns:
        tuple: (adx, plus_di, minus_di) - all as pd.Series
    """
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)

    up_move = high.diff()
    down_move = -low.diff()

    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)

    tr = pd.Series(
        np.maximum(
            high - low,
            np.maximum((high - close.shift(1)).abs(), (low - close.shift(1)).abs())
        ),
        index=df.index
    )

    atr = wilder_rma(tr, period)
    plus_dm_sm = wilder_rma(plus_dm, period)
    minus_dm_sm = wilder_rma(minus_dm, period)

    plus_di = 100 * (plus_dm_sm / atr)
    minus_di = 100 * (minus_dm_sm / atr)

    denom = (plus_di + minus_di)
    # Safe DX: avoid 0/0 -> NaN spikes
    dx = 100 * ((plus_di - minus_di).abs() / denom.replace({0.0: np.nan}))
    dx = dx.fillna(0.0)

    adx = wilder_rma(dx, period)
    return adx, plus_di, minus_di


def robust_atr(df: pd.DataFrame, period: int = ATR_PERIOD, sleeve: str = "") -> tuple[float, float | str, bool, str]:
    """
    Returns:
      atr_14, atr_ref (mean ATR over [-30:-20]), used_fallback, quality_note

    ATR uses OHLC TR but caps outliers. Uses Wilder ATR (RMA).
    If ETF and ATR looks suspiciously large vs price, fallback to close-to-close ATR proxy.
    """
    close = df["Close"].astype(float)

    tr = np.maximum(
        df["High"] - df["Low"],
        np.maximum((df["High"] - close.shift(1)).abs(), (df["Low"] - close.shift(1)).abs())
    )
    tr = pd.Series(tr, index=df.index)

    lookback = min(252, len(tr.dropna()))
    if lookback >= MIN_LOOKBACK_DATA:
        cap = float(tr.dropna().iloc[-lookback:].quantile(0.95))
        tr_capped = tr.clip(upper=cap)
    else:
        tr_capped = tr

    # Wilder ATR (RMA)
    atr = wilder_rma(tr_capped, period)
    atr_14 = float(atr.iloc[-1]) if len(atr) else np.nan

    atr_clean = atr.dropna()
    if len(atr_clean) >= MIN_ATR_DATA:
        atr_ref = float(atr.iloc[-30:-20].mean())
    else:
        atr_ref = np.nan

    used_fallback = False
    note = "TR-capped + Wilder(RMA)"

    price = float(close.iloc[-1]) if len(close) else np.nan
    if sleeve == "ETF_CORE" and np.isfinite(price) and price > 0 and np.isfinite(atr_14):
        # If ATR > 3% of price, likely a bad print / bad OHLC for an ETF listing
        if atr_14 / price > ATR_ETF_THRESHOLD_PCT:
            cc = close.diff().abs()
            atr_proxy = float(wilder_rma(cc, period).iloc[-1]) if len(cc) else np.nan
            if np.isfinite(atr_proxy) and atr_proxy > 0:
                atr_14 = atr_proxy
                used_fallback = True
                note = "FALLBACK: close-to-close Wilder ATR proxy"

    return atr_14, atr_ref, used_fallback, note


def _atr_sanity_check(atr_val: float, price: float, sleeve: str) -> str | None:
    """
    Quick sanity check on ATR value. Returns warning string or None if OK.
    Called after robust_atr() before ATR is used in stop calculations.
    """
    if not np.isfinite(atr_val) or atr_val <= 0:
        return f"ATR={atr_val} (invalid) — stop calculation unsafe"
    if not np.isfinite(price) or price <= 0:
        return None  # Can't check ratio without price
    atr_pct = atr_val / price
    if atr_pct > 0.20:
        return f"ATR%={atr_pct:.2%} (>20%) — possible ticker mismatch or data error"
    if atr_pct < 0.001:
        return f"ATR%={atr_pct:.4%} (<0.1%) — suspiciously low, check data"
    return None


def clean_price_series(price: pd.Series, sleeve: str) -> tuple[pd.Series, bool, str, bool, bool]:
    """
    Iterative outlier detection/repair using LAST VALID price (prevents spike+recovery double-kill).

    Returns:
      repaired_series,
      did_repair (ETF only),
      note,
      anomaly_block (hard reject for new buys),
      anomaly_warn  (informational warning)

    Policy:
      - ETF_CORE: repair obvious bad prints (forward-fill with last valid).
      - Stocks:   DO NOT repair (gaps can be real). Prefer WARN over BLOCK unless extreme.

    Thresholding:
      - ETFs: fixed 8% vs last valid
      - Stocks: dynamic threshold based on recent median absolute daily return:
          thr = max(25%, VOL_MULT * median_abs_return_20d)
        BLOCK only when move is extreme (BLOCK_MULT * median_abs_return_20d) or multiple spikes.
    """
    price = price.astype(float).copy()

    if sleeve == "ETF_CORE":
        thr = 0.08
        repaired = price.copy()
        last_valid = np.nan
        spike_days = 0

        for idx, val in price.items():
            if not np.isfinite(val):
                continue
            if not np.isfinite(last_valid) or last_valid == 0:
                last_valid = val
                continue
            pct = abs(val / last_valid - 1.0)
            if pct > thr:
                spike_days += 1
                repaired.loc[idx] = last_valid
            else:
                last_valid = val

        if spike_days > 0:
            return repaired, True, f"PRICE_CLEAN: repaired {spike_days} spike days (thr={thr:.0%})", False, False
        return repaired, False, "PRICE_CLEAN: none", False, False

    # ---- Stocks: dynamic threshold, warn by default ----
    # Recent volatility proxy: rolling median absolute daily return
    # Use pct changes on finite values only.
    s = price.dropna().astype(float)
    rets = s.pct_change().abs()
    med_abs_ret = float(rets.rolling(VOLATILITY_PERIOD).median().iloc[-1]) if len(rets) >= MEDIAN_WINDOW_MIN else float(rets.median()) if len(rets) else VOLATILITY_DEFAULT
    if not np.isfinite(med_abs_ret) or med_abs_ret <= 0:
        med_abs_ret = VOLATILITY_DEFAULT

    VOL_MULT = 8.0
    BLOCK_MULT = 14.0

    thr_warn = max(0.25, VOL_MULT * med_abs_ret)
    thr_block = max(0.35, BLOCK_MULT * med_abs_ret)

    last_valid = np.nan
    spike_days = 0
    max_spike = 0.0

    for _, val in price.items():
        if not np.isfinite(val):
            continue
        if not np.isfinite(last_valid) or last_valid == 0:
            last_valid = val
            continue
        pct = abs(val / last_valid - 1.0)
        if pct > thr_warn:
            spike_days += 1
            max_spike = max(max_spike, pct)
        last_valid = val

    anomaly_warn = spike_days > 0
    # Block only if clearly extreme or repeated spikes
    anomaly_block = (max_spike > thr_block) or (spike_days >= 2 and max_spike > thr_warn)

    if anomaly_warn:
        kind = "BLOCK" if anomaly_block else "WARN"
        note = f"DATA_{kind}: {spike_days} spike days; max={max_spike:.0%}; thr_warn={thr_warn:.0%}; thr_block={thr_block:.0%} (med_abs_ret~{med_abs_ret:.2%})"
        return price, False, note, bool(anomaly_block), True

    return price, False, f"DATA_OK: no spike days (thr_warn={thr_warn:.0%}; med_abs_ret~{med_abs_ret:.2%})", False, False


def compute_volume_metrics(df: pd.DataFrame) -> dict:
    """
    Uses raw Volume column.
    """
    if "Volume" not in df.columns:
        return {"volume": np.nan, "vol_20_avg": np.nan, "vol_20_med": np.nan, "vol_ratio": np.nan}

    vol = df["Volume"].astype(float)
    volume = float(vol.iloc[-1]) if len(vol) else np.nan
    vol_20 = vol.tail(20)
    vol_20_avg = float(vol_20.mean()) if len(vol_20) else np.nan
    vol_20_med = float(vol_20.median()) if len(vol_20) else np.nan

    base = vol_20_avg if np.isfinite(vol_20_avg) and vol_20_avg > 0 else vol_20_med
    vol_ratio = (volume / base) if np.isfinite(volume) and np.isfinite(base) and base > 0 else np.nan

    return {"volume": volume, "vol_20_avg": vol_20_avg, "vol_20_med": vol_20_med, "vol_ratio": vol_ratio}


def compute_metrics(df: pd.DataFrame, sleeve: str) -> dict:
    # Use Adj Close for levels; fallback Close
    base_price = df["Adj Close"] if "Adj Close" in df.columns else df["Close"]
    price, fixed, fix_note, data_anomaly_block, data_anomaly_warn = clean_price_series(base_price, sleeve=sleeve)

    close = float(price.iloc[-1])

    high_20 = float(price.rolling(LOOKBACK_HIGH_20).max().iloc[-1])
    low_20  = float(price.rolling(LOOKBACK_LOW_20).min().iloc[-1])
    high_55 = float(price.rolling(LOOKBACK_HIGH_55).max().iloc[-1])
    low_55  = float(price.rolling(LOOKBACK_HIGH_55).min().iloc[-1])  # For Early Bird module
    low_10  = float(price.rolling(LOOKBACK_LOW_10).min().iloc[-1])

    ma_50 = float(price.rolling(MA_50_PERIOD).mean().iloc[-1])
    ma_200 = float(price.rolling(MA_200_PERIOD).mean().iloc[-1])

    atr_14, atr_14_20d_ago, used_fallback, atr_note = robust_atr(df, ATR_PERIOD, sleeve=sleeve)

    # System Hardening: ATR sanity check
    _atr_warn = _atr_sanity_check(atr_14, close, sleeve)
    if _atr_warn:
        atr_note = f"{atr_note} | SANITY: {_atr_warn}"

    adx_series, plus_di_series, minus_di_series = calculate_adx(df, ADX_PERIOD)
    adx_14 = float(adx_series.iloc[-1])
    plus_di = float(plus_di_series.iloc[-1])
    minus_di = float(minus_di_series.iloc[-1])

    dist_20 = ((high_20 - close) / high_20) * 100 if high_20 else np.nan
    dist_55 = ((high_55 - close) / high_55) * 100 if high_55 else np.nan
    range_position_20 = (close - low_20) / (high_20 - low_20) if (high_20 - low_20) != 0 else np.nan

    atr_spiking = np.isfinite(atr_14) and np.isfinite(atr_14_20d_ago) and (atr_14 > 1.30 * atr_14_20d_ago)
    atr_collapsing = np.isfinite(atr_14) and np.isfinite(atr_14_20d_ago) and (atr_14 < atr_14_20d_ago)


    h55_prev = price.rolling(LOOKBACK_HIGH_55).max().shift(1)
    chasing_55 = bool((price.iloc[-6:-1] > h55_prev.iloc[-6:-1]).any())

    h20_prev = price.rolling(LOOKBACK_HIGH_20).max().shift(1)
    chasing_20 = bool((price.iloc[-6:-1] > h20_prev.iloc[-6:-1]).any())

    dq_flag_parts = []
    dq_note_parts = []

    if fixed:
        dq_flag_parts.append("PRICE_FIXED")
        dq_note_parts.append(fix_note)

    if data_anomaly_warn:
        dq_flag_parts.append("DATA_WARNING")
        dq_note_parts.append(fix_note)

    if data_anomaly_block:
        dq_flag_parts.append("DATA_ANOMALY_BLOCK")
        dq_note_parts.append(fix_note)

    if used_fallback:
        dq_flag_parts.append("FALLBACK_ATR")
        dq_note_parts.append(atr_note)
    else:
        dq_note_parts.append(atr_note)

    dq_flag = "|".join(dq_flag_parts) if dq_flag_parts else "OK"
    dq_note = " ; ".join(dq_note_parts)

    # Volume/liquidity
    volm = compute_volume_metrics(df)

    # Use median if average is missing/odd
    vol_base = volm.get("vol_20_avg", np.nan)
    if not (np.isfinite(vol_base) and vol_base > 0):
        vol_base = volm.get("vol_20_med", np.nan)

    dollar_vol_20 = float(close * vol_base) if np.isfinite(vol_base) else np.nan

    # Liquidity thresholds (tuneable)
    if sleeve == "ETF_CORE":
        min_dv = 2_500_000  # relaxed for UCITS/UK listings
    else:
        min_dv = 10_000_000

    # Liquidity handling:
    # - ETFs: allow missing volume (UCITS listings can be incomplete) but mark unknown
    # - Stocks: treat missing volume as NOT OK for new buys (prevents illiquid fills / slippage)
    liquidity_unknown = False
    liquidity_status = "LIQUID"
    if np.isfinite(dollar_vol_20):
        liquidity_ok = (dollar_vol_20 >= min_dv)
        liquidity_status = "LIQUID" if liquidity_ok else "ILLIQUID"
    else:
        liquidity_unknown = True
        liquidity_status = "UNKNOWN"
        liquidity_ok = True if sleeve == "ETF_CORE" else False

    atr_pct = (atr_14 / close) if np.isfinite(close) and close > 0 and np.isfinite(atr_14) else np.nan

    # ==========================================================================
    # MODULE 4: TREND EFFICIENCY (Smoothness Score)
    # ==========================================================================
    # Efficiency = |Net Move| / Total Path Traveled
    # A stock that goes straight up has efficiency ~1.0
    # A choppy stock that zig-zags has efficiency ~0.2
    trend_efficiency = np.nan
    if TREND_EFFICIENCY_ENABLED and len(price) >= TREND_EFFICIENCY_LOOKBACK:
        try:
            recent = price.tail(TREND_EFFICIENCY_LOOKBACK + 1)
            net_move = abs(float(recent.iloc[-1]) - float(recent.iloc[0]))
            daily_moves = recent.diff().abs().dropna()
            total_path = float(daily_moves.sum())
            if total_path > 0:
                trend_efficiency = net_move / total_path
        except Exception:
            trend_efficiency = np.nan

    # ==========================================================================
    # MODULE 5: CLIMAX TOP DETECTION (MA Extension + Volume Climax)
    # ==========================================================================
    # ma_extension_pct = (close - ma_20) / ma_20
    # If > 25% above MA20 and volume > 3x avg, it's a potential climax
    ma_20 = float(price.rolling(20).mean().iloc[-1]) if len(price) >= 20 else np.nan
    ma_extension_pct = (close - ma_20) / ma_20 if np.isfinite(ma_20) and ma_20 > 0 else np.nan
    
    # ==========================================================================
    # MODULE 6: 3-MONTH RETURN (for Relative Strength calculation)
    # ==========================================================================
    return_3m = np.nan
    if RS_RANKING_ENABLED and len(price) >= RS_LOOKBACK_DAYS:
        try:
            price_3m_ago = float(price.iloc[-RS_LOOKBACK_DAYS])
            if np.isfinite(price_3m_ago) and price_3m_ago > 0:
                return_3m = (close - price_3m_ago) / price_3m_ago
        except Exception:
            return_3m = np.nan
    
    vol_ratio_current = volm.get("vol_ratio", np.nan)
    is_climax_top = False
    if CLIMAX_EXIT_ENABLED:
        is_extended = np.isfinite(ma_extension_pct) and ma_extension_pct >= CLIMAX_MA_EXTENSION_PCT
        is_volume_climax = np.isfinite(vol_ratio_current) and vol_ratio_current >= CLIMAX_VOLUME_MULT
        is_climax_top = is_extended and is_volume_climax

    return {
        "close": close,
        "high_20": high_20,
        "high_55": high_55,
        "low_10": low_10,
        "low_20": low_20,
        "low_55": low_55,
        "atr_14": atr_14,
        "atr_14_20d_ago": atr_14_20d_ago,
        "adx_14": adx_14,
        "plus_di": plus_di,
        "minus_di": minus_di,
        "ma_50": ma_50,
        "ma_200": ma_200,
        "distance_to_20d_high_pct": dist_20,
        "distance_to_55d_high_pct": dist_55,
        "range_position_20": range_position_20,
        "atr_spiking": bool(atr_spiking),
        "atr_collapsing": bool(atr_collapsing),
        "chasing_55_last5": chasing_55,
        "chasing_20_last5": chasing_20,
        "data_quality_flag": dq_flag,
        "data_quality_note": dq_note,
        "data_anomaly": bool(data_anomaly_block),
        "data_anomaly_block": bool(data_anomaly_block),
        "data_anomaly_warn": bool(data_anomaly_warn),
        "atr_pct": atr_pct,
        "dollar_vol_20": dollar_vol_20,
        "liquidity_ok": bool(liquidity_ok),
        "liquidity_unknown": bool(liquidity_unknown),
        "liquidity_status": liquidity_status,
        "trend_efficiency": trend_efficiency,
        "ma_20": ma_20,
        "ma_extension_pct": ma_extension_pct,
        "is_climax_top": bool(is_climax_top),
        "return_3m": return_3m,
        **volm,
    }


# ----------------------------
# Classification / Stops / Adds
# ----------------------------

def check_early_bird_eligible(row: dict) -> tuple[bool, str]:
    """
    ==========================================================================
    MODULE 2: MOMENTUM "EARLY BIRD" ENTRY
    ==========================================================================
    Checks if a stock qualifies for "aggressive entry" even if ADX < 20.
    
    Rationale:
    The standard ADX > 20 filter is LAGGING - by the time ADX confirms trend,
    much of the move has already happened. For fast-moving breakouts, we miss
    the best entry.
    
    Early Bird Criteria (ALL must be met):
    1. Price in top 10% of 55-day range -> strong momentum, near 55d highs
    2. Volume Ratio >= 1.5 -> above-average volume = conviction
    3. ADX >= 15 -> some directional movement (not completely flat)
    4. Market Regime = BULLISH -> only in favorable conditions
    5. Not ETF (ETFs use different logic)
    
    Math:
      range_position_55 = (close - low_55) / (high_55 - low_55)
      If range_position_55 >= 0.90 -> in top 10%
    
    This bypasses the +DI > -DI and ADX > 20 requirements for qualifying stocks.
    All other risk gates (cluster caps, sleeve caps) still apply.
    ==========================================================================
    """
    if not EARLY_BIRD_ENABLED:
        return (False, "")
    
    sleeve = row.get("sleeve", "")
    market_regime = row.get("market_regime", "")
    
    # Only for stocks, only in BULLISH
    if sleeve == "ETF_CORE":
        return (False, "ETFs use 55d logic")
    if market_regime != "BULLISH":
        return (False, "Not BULLISH regime")
    
    # Get required values
    close = row.get("close", np.nan)
    high_55 = row.get("high_55", np.nan)
    low_55 = row.get("low_55", np.nan)  # May need to compute this
    adx = row.get("adx_14", np.nan)
    vol_ratio = row.get("vol_ratio", np.nan)
    
    # Compute range position in 55-day range
    # If low_55 not available, use low_20 as proxy (less accurate but functional)
    if not np.isfinite(low_55):
        low_55 = row.get("low_20", np.nan)
    
    if not all(np.isfinite(x) for x in [close, high_55, low_55, adx]):
        return (False, "Missing data for Early Bird check")
    
    range_55 = high_55 - low_55
    if range_55 <= 0:
        return (False, "Invalid 55d range")
    
    range_position_55 = (close - low_55) / range_55
    
    # Check criteria
    if range_position_55 < EARLY_BIRD_RANGE_THRESHOLD:
        return (False, f"Range position {range_position_55:.0%} < {EARLY_BIRD_RANGE_THRESHOLD:.0%}")
    
    if not np.isfinite(vol_ratio) or vol_ratio < EARLY_BIRD_VOLUME_RATIO_MIN:
        vol_str = f"{vol_ratio:.1f}" if np.isfinite(vol_ratio) else "N/A"
        return (False, f"Volume ratio {vol_str} < {EARLY_BIRD_VOLUME_RATIO_MIN}")
    
    if adx < EARLY_BIRD_ADX_MIN:
        return (False, f"ADX {adx:.0f} < {EARLY_BIRD_ADX_MIN}")
    
    # All criteria met!
    return (True, f"EARLY_BIRD: top {(1-range_position_55)*100:.0f}% of 55d range, vol {vol_ratio:.1f}x, ADX {adx:.0f}")


def check_laggard_purge(row: dict, pos_state: dict) -> dict:
    """
    ==========================================================================
    MODULE 3: THE "LAGGARD" PURGE
    ==========================================================================
    Identifies positions that are underperforming and tying up capital.
    
    Rationale:
    Backtest analysis showed 28 "laggards" - positions held >10 days while
    in loss (but not hitting stop). These tied up $24,379 in capital that
    could have been redeployed to higher-momentum opportunities.
    
    Laggard Criteria (ALL must be met):
    1. Position held >= LAGGARD_HOLDING_DAYS (default: 10 days)
    2. Currently in loss (close < entry_price)
    3. NOT hitting stop (so not an automatic exit)
    4. Is a held position
    
    This is a SUGGESTION, not an automatic action. The held_action will show
    "TRIM_LAGGARD" and held_action_reason will explain why.
    
    User decides whether to:
    - Keep position (maybe it's a strategic hold)
    - Trim position (partial sale to free capital)
    - Close position (full exit to redeploy capital)
    ==========================================================================
    """
    out = {
        "is_laggard": False,
        "laggard_reason": "",
        "holding_days": np.nan,
        "laggard_loss_pct": np.nan,
    }
    
    if not LAGGARD_PURGE_ENABLED:
        return out
    
    if not row.get("is_held", False):
        return out
    
    t = str(row.get("ticker", "")).upper()
    state = pos_state.get(t, {})
    
    # Get entry info
    entry_price = float(state.get("entry_price", np.nan))
    close = float(row.get("close", np.nan))
    
    if not np.isfinite(entry_price) or not np.isfinite(close):
        return out
    
    # Check if in loss
    if close >= entry_price:
        return out  # Not a loser, not a laggard
    
    loss_pct = (entry_price - close) / entry_price * 100
    out["laggard_loss_pct"] = loss_pct
    
    # Check holding period using entry_date from positions_state.csv
    entry_date_str = str(state.get("entry_date", "")).strip()
    holding_days = np.nan
    
    if not entry_date_str or entry_date_str == "nan" or entry_date_str == "":
        # No entry_date in positions_state — use fallback heuristic
        holding_days_from_row = row.get("holding_days", np.nan)
        if np.isfinite(holding_days_from_row):
            holding_days = holding_days_from_row
        elif np.isfinite(state.get("active_stop", np.nan)):
            # Has been processed before, conservative proxy
            holding_days = LAGGARD_HOLDING_DAYS + 1
        else:
            holding_days = 0
        print(f"[WARN] {t}: no entry_date in positions_state — laggard check using fallback ({holding_days:.0f}d)")
    else:
        try:
            entry_date_parsed = datetime.strptime(entry_date_str[:10], "%Y-%m-%d").date()
            holding_days = (date.today() - entry_date_parsed).days
        except (ValueError, TypeError):
            holding_days = 0
            print(f"[WARN] {t}: malformed entry_date '{entry_date_str}' — laggard check skipped")
    
    out["holding_days"] = holding_days
    
    if holding_days < LAGGARD_HOLDING_DAYS:
        return out
    
    # Check if loss is significant enough
    if loss_pct < LAGGARD_MIN_LOSS_PCT:
        return out
    
    # All criteria met - this is a laggard
    out["is_laggard"] = True
    out["laggard_reason"] = f"Held {holding_days:.0f}d in loss ({loss_pct:.1f}%), consider trimming to recycle capital"
    
    return out


def check_climax_exit(row: dict) -> tuple[bool, str, dict]:
    """
    ==========================================================================
    MODULE 5: CLIMAX TOP EXIT (Profit Harvesting)
    ==========================================================================
    Detects "blow-off top" conditions for held positions:
    - Price > 25% above 20-day MA (parabolic extension)
    - Volume > 3x 20-day average (climax volume = institutions selling)
    
    TIER 2 FIX: Returns tighten_stop or trim suggestion instead of hard sell.
    
    Returns: (is_climax, reason, climax_info)
    ==========================================================================
    """
    climax_info = {
        "climax_flag": False,
        "climax_action": "",
        "climax_suggested_stop": np.nan,
    }
    
    if not CLIMAX_EXIT_ENABLED:
        return (False, "", climax_info)
    
    if not row.get("is_held", False):
        return (False, "", climax_info)
    
    is_climax = row.get("is_climax_top", False)
    if not is_climax:
        return (False, "", climax_info)
    
    climax_info["climax_flag"] = True
    
    ma_ext = row.get("ma_extension_pct", 0)
    vol_ratio = row.get("vol_ratio", 0)
    close = row.get("close", np.nan)
    atr = row.get("atr_14", np.nan)
    active_stop = row.get("active_stop", np.nan)
    
    # TIER 2 FIX: Use configured action instead of hard sell
    if CLIMAX_ACTION == "tighten_stop":
        # Tighten stop to close - ATR*mult
        if np.isfinite(close) and np.isfinite(atr) and atr > 0:
            suggested_stop = close - (CLIMAX_ATR_TIGHTEN_MULT * atr)
            # Only suggest if it would tighten (not loosen)
            if np.isfinite(active_stop):
                suggested_stop = max(suggested_stop, active_stop)
            climax_info["climax_suggested_stop"] = suggested_stop
            climax_info["climax_action"] = "TIGHTEN_STOP"
            reason = f"CLIMAX: +{ma_ext*100:.0f}% above MA20, vol {vol_ratio:.1f}x - tighten stop to {suggested_stop:.2f}"
        else:
            climax_info["climax_action"] = "TIGHTEN_STOP"
            reason = f"CLIMAX TOP: +{ma_ext*100:.0f}% above MA20, volume {vol_ratio:.1f}x - consider tightening stop"
    elif CLIMAX_ACTION == "trim":
        climax_info["climax_action"] = "TRIM"
        reason = f"CLIMAX: +{ma_ext*100:.0f}% above MA20, vol {vol_ratio:.1f}x - suggest trim {CLIMAX_TRIM_PCT*100:.0f}%"
    else:
        # Default to original behavior (sell)
        climax_info["climax_action"] = "SELL"
        reason = f"CLIMAX TOP: +{ma_ext*100:.0f}% above MA20, volume {vol_ratio:.1f}x avg - sell into strength!"
    
    return (True, reason, climax_info)


def compute_execution_guard(row: dict) -> dict:
    """
    ==========================================================================
    TIER 1: MONDAY EXECUTION GUARD (Gap/Extension Filter)
    ==========================================================================
    For non-held READY candidates, compute whether the current (weekend) close
    is too extended above the entry trigger. If so, Monday should skip the buy.
    
    Guard FAILS if EITHER threshold exceeded:
      - (close - trigger) / ATR > EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER
      - (close / trigger - 1) > EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER
    
    Returns dict with:
      - exec_guard_pass: bool
      - exec_guard_reason: str
      - extension_atr_above_trigger: float
      - extension_pct_above_trigger: float
    ==========================================================================
    """
    out = {
        "exec_guard_pass": True,
        "exec_guard_reason": "",
        "extension_atr_above_trigger": np.nan,
        "extension_pct_above_trigger": np.nan,
    }
    
    if not EXEC_GUARD_ENABLED:
        out["exec_guard_reason"] = "GUARD_DISABLED"
        return out
    
    # Only applies to non-held READY candidates
    if row.get("is_held", False):
        out["exec_guard_reason"] = "HELD_POSITION"
        return out
    
    if str(row.get("status", "")).upper() != "READY":
        out["exec_guard_reason"] = "NOT_READY"
        return out
    
    close = row.get("close", np.nan)
    trigger = row.get("entry_trigger", np.nan)
    atr = row.get("atr_14", np.nan)
    
    if not np.isfinite(trigger) or trigger <= 0:
        out["exec_guard_reason"] = "NO_TRIGGER"
        return out
    
    # Calculate extension metrics
    if np.isfinite(close) and np.isfinite(atr) and atr > 0:
        out["extension_atr_above_trigger"] = (close - trigger) / atr
    
    if np.isfinite(close):
        out["extension_pct_above_trigger"] = (close / trigger) - 1.0
    
    # Check thresholds
    fail_reasons = []
    
    ext_atr = out["extension_atr_above_trigger"]
    ext_pct = out["extension_pct_above_trigger"]
    
    if np.isfinite(ext_atr) and ext_atr > EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER:
        fail_reasons.append(f"ATR extension {ext_atr:.2f} > {EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER}")
    
    if np.isfinite(ext_pct) and ext_pct > EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER:
        fail_reasons.append(f"PCT extension {ext_pct*100:.1f}% > {EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER*100:.0f}%")
    
    if fail_reasons:
        out["exec_guard_pass"] = False
        out["exec_guard_reason"] = "SKIP: " + ", ".join(fail_reasons)
    else:
        out["exec_guard_reason"] = "PASS"
    
    return out


def compute_adaptive_atr_buffer(atr_pct: float) -> float:
    """
    ==========================================================================
    TIER 2: ADAPTIVE ATR ENTRY BUFFER
    ==========================================================================
    Computes the ATR buffer multiplier based on the stock's volatility (ATR%).
    
    If ATR_BUFFER_MODE == "fixed": returns ATR_ENTRY_BUFFER_MULT (e.g., 0.10)
    If ATR_BUFFER_MODE == "adaptive":
      buffer_mult = clamp(0.05, 0.20, 0.18 - 0.60*atr_pct)
    
    Higher ATR% stocks get SMALLER buffer (volatile stocks overshoot breakouts naturally)
    Lower ATR% stocks get LARGER buffer (calm stocks need more confirmation)
    ==========================================================================
    """
    if ATR_BUFFER_MODE != "adaptive":
        return ATR_ENTRY_BUFFER_MULT  # Fixed mode
    
    if not np.isfinite(atr_pct) or atr_pct <= 0:
        return ATR_BUFFER_ADAPTIVE_BASE  # Fallback to base
    
    # TIER 2: Inverse formula: calm stocks get larger buffer, volatile get smaller
    buffer_mult = 0.18 - (ATR_BUFFER_ADAPTIVE_K * atr_pct)
    
    # Clamp to bounds
    buffer_mult = max(ATR_BUFFER_MIN, min(ATR_BUFFER_MAX, buffer_mult))
    
    return buffer_mult


def compute_relative_strength(row: dict, benchmark_return_3m: float) -> dict:
    """
    ==========================================================================
    MODULE 6: RELATIVE STRENGTH (RS) vs Benchmark
    ==========================================================================
    Compares stock's 3-month performance against benchmark.
    
    RS Score = stock_return_3m - benchmark_return_3m
    - Positive RS = outperforming
    - Negative RS = underperforming
    
    Used to identify "latent leaders" during market transitions.
    ==========================================================================
    """
    out = {
        "return_3m": np.nan,
        "rs_vs_benchmark": np.nan,
        "rs_rank": np.nan,  # Will be filled in post-processing
    }
    
    if not RS_RANKING_ENABLED:
        return out
    
    stock_return_3m = row.get("return_3m", np.nan)
    
    if np.isfinite(stock_return_3m) and np.isfinite(benchmark_return_3m):
        out["return_3m"] = stock_return_3m
        out["rs_vs_benchmark"] = stock_return_3m - benchmark_return_3m
    
    return out


# =============================================================================
# MODULE 8: THE "HEAT CHECK" (Correlation Filter / Cluster Concentration)
# =============================================================================
def check_heat_check(row: dict, cluster_holdings: dict, cluster_momentum_avg: dict) -> tuple[bool, str]:
    """
    If we already hold >= HEAT_CHECK_CLUSTER_THRESHOLD (3) stocks in the same
    Cluster, a new entry must have momentum score at least 20% BETTER than
    the average of existing holdings in that cluster.
    
    Returns: (blocked, reason)
      - blocked=True means this entry should stay in WATCH
      - blocked=False means entry is allowed
    """
    if not HEAT_CHECK_ENABLED:
        return (False, "")
    
    if row.get("is_held", False):
        return (False, "")  # Only applies to new entries
    
    cluster = row.get("cluster", "")
    if not cluster:
        return (False, "")
    
    # How many stocks do we hold in this cluster?
    held_count = cluster_holdings.get(cluster, 0)
    if held_count < HEAT_CHECK_CLUSTER_THRESHOLD:
        return (False, "")  # Cluster not crowded yet
    
    # Get this candidate's momentum score (lower = better)
    candidate_rank = row.get("rank_score", np.nan)
    if not np.isfinite(candidate_rank):
        return (True, f"HEAT_CHECK blocked: cluster {cluster} has {held_count} positions, no rank_score to compare")
    
    # Get average momentum of existing holdings in cluster
    avg_rank = cluster_momentum_avg.get(cluster, np.nan)
    if not np.isfinite(avg_rank):
        return (False, "")  # Can't compare, allow entry
    
    # New entry must be 20% BETTER (i.e., rank_score 20% lower)
    # "Better" means lower rank_score, so threshold = avg_rank * (1 - 0.20) = avg_rank * 0.80
    threshold = avg_rank * (1.0 - HEAT_CHECK_MOMENTUM_PREMIUM)
    
    if candidate_rank <= threshold:
        # Candidate is a superstar, allow entry
        return (False, f"HEAT_CHECK passed: rank {candidate_rank:.0f} <= {threshold:.0f} (20% better than avg {avg_rank:.0f})")
    else:
        # Candidate is not good enough for crowded cluster
        return (True, f"HEAT_CHECK blocked: rank {candidate_rank:.0f} > {threshold:.0f} threshold in cluster {cluster} ({held_count} positions)")


# =============================================================================
# MODULE 9: THE "FAST-FOLLOWER" RE-ENTRY
# =============================================================================
def check_fast_follower_reentry(ticker: str, row: dict, pos_state: dict, today_date: str) -> dict:
    """
    Check if a stock that was stopped out recently has now reclaimed its
    20-day high with strong volume, signaling a squeeze/re-entry opportunity.
    
    Conditions for RE_ENTRY_SQUEEZE:
    1. Stock was sold due to STOP_HIT within last FAST_FOLLOWER_LOOKBACK_DAYS (10)
    2. Price has reclaimed the 20-day high (close >= high_20)
    3. Volume ratio > FAST_FOLLOWER_VOLUME_RATIO_MIN (2.0)
    
    Returns dict with fast_follower_eligible, fast_follower_reason
    """
    out = {
        "fast_follower_eligible": False,
        "fast_follower_reason": "",
        "last_exit_reason": "",
    }
    
    if not FAST_FOLLOWER_ENABLED:
        return out
    
    # Only for stocks not currently held
    if row.get("is_held", False):
        return out
    
    t = ticker.upper()
    if t not in pos_state:
        return out
    
    state = pos_state[t]
    last_exit_date = state.get("last_exit_date", "")
    last_exit_reason = state.get("last_exit_reason", "")
    
    out["last_exit_reason"] = last_exit_reason
    
    # Must have been a STOP_HIT exit
    if last_exit_reason != "STOP_HIT":
        return out
    
    # Check days since exit
    if not last_exit_date:
        return out
    
    try:
        exit_dt = datetime.strptime(last_exit_date[:10], "%Y-%m-%d")
        today_dt = datetime.strptime(today_date[:10], "%Y-%m-%d")
        days_since_exit = (today_dt - exit_dt).days
        
        if days_since_exit > FAST_FOLLOWER_LOOKBACK_DAYS:
            out["fast_follower_reason"] = f"Too long since stop-hit ({days_since_exit}d > {FAST_FOLLOWER_LOOKBACK_DAYS}d)"
            return out
    except Exception:
        return out
    
    # Check if price reclaimed 20-day high
    close = row.get("close", np.nan)
    high_20 = row.get("high_20", np.nan)
    
    if not (np.isfinite(close) and np.isfinite(high_20)):
        return out
    
    if FAST_FOLLOWER_REQUIRE_NEW_HIGH and close < high_20:
        out["fast_follower_reason"] = f"Not at 20d high yet (close {close:.2f} < high_20 {high_20:.2f})"
        return out
    
    # Check volume confirmation
    vol_ratio = row.get("vol_ratio", np.nan)
    if not np.isfinite(vol_ratio) or vol_ratio < FAST_FOLLOWER_VOLUME_RATIO_MIN:
        out["fast_follower_reason"] = f"Volume too low ({vol_ratio:.1f}x < {FAST_FOLLOWER_VOLUME_RATIO_MIN}x required)"
        return out
    
    # All conditions met!
    out["fast_follower_eligible"] = True
    out["fast_follower_reason"] = f"RE_ENTRY_SQUEEZE: Reclaimed 20d high {days_since_exit}d after stop-hit, vol {vol_ratio:.1f}x"
    return out


# =============================================================================
# MODULE 10: THE "MARKET BREADTH" SAFETY VALVE
# =============================================================================
def compute_market_breadth(sample_size: int = BREADTH_SAMPLE_SIZE, universe_df: pd.DataFrame = None) -> dict:
    """
    Compute market breadth using OUR UNIVERSE (Tier 1 fix).
    
    UniverseBreadthPct = % of tickers in scanned universe above their MA50
    - Excludes HEDGE sleeve
    - Uses already-downloaded indicators (no extra API calls)
    
    Returns dict with:
      - breadth_pct: percentage of universe above 50DMA
      - breadth_healthy: True if >= BREADTH_THRESHOLD_PCT
      - effective_max_positions: adjusted MAX_POSITIONS based on breadth
    """
    out = {
        "breadth_pct": np.nan,
        "breadth_healthy": False,  # Conservative default when we can't compute
        "effective_max_positions": BREADTH_REDUCED_MAX_POSITIONS,
        "breadth_sample_size": 0,
        "breadth_above_50dma": 0,
        "breadth_source": "universe",  # Tier 1: Document source
    }
    
    if not BREADTH_SAFETY_ENABLED:
        out["breadth_healthy"] = True
        out["effective_max_positions"] = MAX_POSITIONS
        return out
    
    # TIER 1 FIX: Use universe data if provided (preferred)
    if BREADTH_USE_UNIVERSE and universe_df is not None and not universe_df.empty:
        try:
            # Filter: exclude HEDGE sleeve, require valid close and ma_50
            eligible = universe_df[
                (universe_df["sleeve"] != "HEDGE") &
                (universe_df["close"].notna()) &
                (universe_df["ma_50"].notna())
            ].copy()
            
            if eligible.empty:
                print("[BREADTH] No eligible universe tickers for breadth calculation")
                return out
            
            above_50dma = (eligible["close"] > eligible["ma_50"]).sum()
            total_count = len(eligible)
            
            breadth_pct = above_50dma / total_count if total_count > 0 else np.nan
            out["breadth_pct"] = breadth_pct
            out["breadth_sample_size"] = total_count
            out["breadth_above_50dma"] = int(above_50dma)
            out["breadth_healthy"] = breadth_pct >= BREADTH_THRESHOLD_PCT
            out["breadth_source"] = "universe"
            
            if not out["breadth_healthy"]:
                out["effective_max_positions"] = BREADTH_REDUCED_MAX_POSITIONS
                print(f"[BREADTH WARNING] Only {breadth_pct*100:.1f}% of universe above 50DMA (< {BREADTH_THRESHOLD_PCT*100:.0f}% threshold)")
                print(f"                 Reducing MAX_POSITIONS from {MAX_POSITIONS} to {BREADTH_REDUCED_MAX_POSITIONS}")
            else:
                print(f"[BREADTH OK] {breadth_pct*100:.1f}% of universe ({total_count} tickers) above 50DMA - breadth healthy")
            
            return out
            
        except Exception as e:
            print(f"[WARN] Universe breadth calculation failed: {e}")
            # Fall through to legacy S&P sample if universe calc fails
    
    # LEGACY FALLBACK: S&P 500 sample (only if universe not available)
    out["breadth_source"] = "sp500_sample"
    
    # Diverse sample of S&P 500 stocks (representing different sectors)
    SP500_SAMPLE = [
        # Tech
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "AVGO", "CSCO", "ADBE", "CRM",
        # Healthcare
        "UNH", "JNJ", "PFE", "ABBV", "MRK", "LLY", "BMY", "AMGN", "GILD", "CVS",
        # Financials
        "JPM", "BAC", "WFC", "GS", "MS", "BLK", "AXP", "C", "SCHW", "USB",
        # Consumer
        "TSLA", "HD", "MCD", "NKE", "SBUX", "TGT", "COST", "LOW", "WMT", "PG",
        # Energy/Industrials
        "XOM", "CVX", "COP", "SLB", "CAT", "BA", "GE", "HON", "UPS", "RTX",
    ]
    
    sample = SP500_SAMPLE[:sample_size]
    above_50dma = 0
    valid_count = 0
    
    try:
        # Download in batch for efficiency
        tickers_str = " ".join(sample)
        data = yf.download(tickers_str, period="90d", progress=False, threads=True)
        
        if data.empty:
            return out
        
        for ticker in sample:
            try:
                if isinstance(data.columns, pd.MultiIndex):
                    close_col = data["Adj Close"][ticker] if "Adj Close" in data.columns.get_level_values(0) else data["Close"][ticker]
                else:
                    close_col = data["Adj Close"] if "Adj Close" in data.columns else data["Close"]
                
                close = close_col.dropna()
                if len(close) < 55:
                    continue
                
                current_close = close.iloc[-1]
                ma_50 = close.rolling(50).mean().iloc[-1]
                
                if np.isfinite(current_close) and np.isfinite(ma_50):
                    valid_count += 1
                    if current_close > ma_50:
                        above_50dma += 1
            except Exception:
                continue
        
        if valid_count > 0:
            breadth_pct = above_50dma / valid_count
            out["breadth_pct"] = breadth_pct
            out["breadth_sample_size"] = valid_count
            out["breadth_above_50dma"] = above_50dma
            out["breadth_healthy"] = breadth_pct >= BREADTH_THRESHOLD_PCT
            
            if not out["breadth_healthy"]:
                out["effective_max_positions"] = BREADTH_REDUCED_MAX_POSITIONS
                print(f"[BREADTH WARNING] Only {breadth_pct*100:.1f}% of S&P500 sample above 50DMA (< {BREADTH_THRESHOLD_PCT*100:.0f}% threshold)")
                print(f"                 Reducing MAX_POSITIONS from {MAX_POSITIONS} to {BREADTH_REDUCED_MAX_POSITIONS}")
            else:
                print(f"[BREADTH OK] {breadth_pct*100:.1f}% of S&P500 sample above 50DMA - market breadth healthy")
    
    except Exception as e:
        print(f"[WARN] Could not compute market breadth: {e}")
    
    return out


def check_swap_for_leader(row: dict, cluster_holdings: dict, cluster_at_cap: set, 
                          ready_candidates: pd.DataFrame) -> tuple[bool, str, str]:
    """
    ==========================================================================
    MODULE 7: HEAT-MAP SWAP LOGIC (Cluster Quality Upgrade + Laggard Replacement)
    ==========================================================================
    Two swap conditions:
    1. CLUSTER CAP SWAP: If a cluster is at risk cap AND a new READY candidate 
       in the same cluster has higher momentum, suggest swap.
    2. LAGGARD SWAP: If a held position is IGNORE/WATCH status with low profit 
       (< 0.5R), suggest swapping for best eligible READY candidate (any cluster).
    
    Returns: (should_swap, swap_reason, swap_for_ticker)
    ==========================================================================
    """
    if not SWAP_LOGIC_ENABLED:
        return (False, "", "")
    
    if not row.get("is_held", False):
        return (False, "", "")
    
    if ready_candidates.empty:
        return (False, "", "")
    
    cluster = row.get("cluster", "")
    
    # --- CONDITION 1: CLUSTER CAP SWAP (original logic) ---
    if cluster and cluster in cluster_at_cap:
        holding_rank = row.get("rank_score", np.nan)
        if not np.isfinite(holding_rank):
            holding_rank = row.get("distance_to_20d_high_pct", 50) * 1000
        
        same_cluster = ready_candidates[ready_candidates["cluster"] == cluster]
        if not same_cluster.empty:
            best_candidate = same_cluster.sort_values("rank_score").iloc[0]
            candidate_rank = best_candidate.get("rank_score", np.nan)
            
            if np.isfinite(candidate_rank) and candidate_rank < holding_rank:
                swap_ticker = best_candidate.get("ticker", "UNKNOWN")
                reason = f"SWAP: {swap_ticker} has better momentum (rank {candidate_rank:.0f} vs {holding_rank:.0f}) in capped cluster {cluster}"
                return (True, reason, swap_ticker)
    
    # --- CONDITION 2: LAGGARD SWAP (new logic) ---
    # Held position in IGNORE or WATCH with low profit -> swap for best READY
    status = str(row.get("status", "")).upper()
    profit_r = row.get("profit_r", np.nan)
    
    # Laggard criteria: IGNORE/WATCH status AND profit < 0.5R
    # Skip positions with significant unrealized profit (>2R) to avoid forfeiting gains
    is_laggard = (
        (status in ["IGNORE", "WATCH"]) and 
        (np.isfinite(profit_r) and profit_r < 0.5) and
        not (np.isfinite(profit_r) and profit_r > 2.0)  # Don't swap profitable positions
    )
    
    if is_laggard:
        # Find best READY candidate (any cluster) — filter by eligible if available
        if "eligible_by_risk_caps" in ready_candidates.columns:
            eligible_ready = ready_candidates[ready_candidates["eligible_by_risk_caps"] == True].copy()
        else:
            eligible_ready = ready_candidates.copy()
        
        if not eligible_ready.empty:
            best_candidate = eligible_ready.sort_values("rank_score").iloc[0]
            swap_ticker = best_candidate.get("ticker", "UNKNOWN")
            swap_cluster = best_candidate.get("cluster", "")
            reason = f"LAGGARD_SWAP: Replace {status} position ({profit_r:.2f}R) with {swap_ticker} ({swap_cluster})"
            return (True, reason, swap_ticker)
    
    return (False, "", "")


def classify(row: dict) -> tuple[str, str, str, float, float, float, float]:
    """
    Returns: regime, status, reason, breakout_level, stop_level, entry_trigger, atr_buffer_mult_used
    
    TIER 2: entry_trigger = breakout_level + buffer_mult * ATR
    Buffer can be fixed (ATR_ENTRY_BUFFER_MULT) or adaptive based on ATR%.
    
    Applies market_regime risk-off gating to NEW buys.
    """
    sleeve = row["sleeve"]
    close = row["close"]
    ma200 = row["ma_200"]
    ma50 = row["ma_50"]
    adx = row["adx_14"]
    plus_di = row.get("plus_di", np.nan)
    minus_di = row.get("minus_di", np.nan)
    atr = row.get("atr_14", np.nan)
    atr_pct = row.get("atr_pct", np.nan)
    atr_spiking = row["atr_spiking"]
    atr_collapsing = row["atr_collapsing"]

    breakout_level = np.nan
    stop_level = np.nan
    entry_trigger = np.nan
    
    # TIER 2: Compute adaptive or fixed buffer multiplier
    atr_buffer_mult_used = compute_adaptive_atr_buffer(atr_pct)

    def calc_entry_trigger(brk: float, atr_val: float) -> float:
        """Calculate entry trigger = breakout + buffer_mult * ATR (adaptive or fixed)"""
        if np.isfinite(brk) and np.isfinite(atr_val) and atr_val > 0:
            return brk + (atr_buffer_mult_used * atr_val)
        return brk

    # Safety gates for NEW entries (still allow held positions to be managed)
    if (not row.get("is_held", False)):
        if row.get("data_anomaly_block", row.get("data_anomaly", False)):
            return ("IGNORE", "IGNORE", "Data anomaly flagged (spike/gap) - skip new entries", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        if (not row.get("liquidity_ok", True)):
            return ("IGNORE", "IGNORE", "Liquidity failed (20D dollar volume too low)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        
        # =============================================================
        # MODULE 2: EARLY BIRD ENTRY - Bypass ADX filter for momentum
        # =============================================================
        # Check if stock qualifies for Early Bird entry (top 10% of 55d range + high volume)
        # If so, we bypass the ADX direction filter below
        early_bird_eligible, early_bird_reason = check_early_bird_eligible(row)
        
        # ADX Direction Filter: +DI must be > -DI (bullish directional movement)
        # EXCEPTION: Early Bird stocks can bypass this requirement
        if ADX_DIRECTION_FILTER and not early_bird_eligible:
            if np.isfinite(plus_di) and np.isfinite(minus_di) and minus_di > plus_di:
                return ("IGNORE", "IGNORE", "ADX direction bearish (-DI > +DI)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        
        # =============================================================
        # "SLEEP WELL" ATR% CAP - Block overly volatile stocks
        # =============================================================
        # A stock moving 8%+ per day is too volatile for 0.75% risk model
        # Position size would be too small or stop too wide to be safe
        if ATR_PCT_CAP_ENABLED:
            cap = ATR_PCT_CAP_HIGH_RISK if sleeve == "STOCK_HIGH_RISK" else ATR_PCT_CAP_ALL
            if np.isfinite(atr_pct) and atr_pct > cap:
                return ("IGNORE", "IGNORE", f"ATR% too volatile ({atr_pct:.1%} > {cap:.0%}) - Sleep Well filter", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
    else:
        early_bird_eligible = False
        early_bird_reason = ""

    market_regime = row.get("market_regime", "BULLISH")
    is_held = bool(row.get("is_held", False))

    # Risk-off gating for NEW entries (held positions still managed normally)
    if (not is_held) and (market_regime in ("BEARISH", "SIDEWAYS", "UNKNOWN")):
        if sleeve == "ETF_CORE":
            breakout_level = row["high_55"]
            stop_level = row["low_20"]
        else:
            breakout_level = row["high_20"]
            stop_level = max(breakout_level - (2 * row["atr_14"]), row["low_20"])
        entry_trigger = calc_entry_trigger(breakout_level, atr)
        return (market_regime, "IGNORE", f"Market regime not bullish ({market_regime})", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)

    # ---------- ETFs ----------
    if sleeve == "ETF_CORE":
        breakout_level = row["high_55"]
        stop_level = row["low_20"]
        entry_trigger = calc_entry_trigger(breakout_level, atr)

        if (close > ma200) and (ma50 > ma200) and (adx >= ADX_STRONG_TREND):
            regime = "TREND"
        else:
            return ("IGNORE", "IGNORE", "Regime failed (ETF)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)

        # prevent FOMO entries - allow closes above breakout only if NOT extended vs ATR
        extension_atr = ((close - breakout_level) / row["atr_14"]) if (
            np.isfinite(breakout_level) and np.isfinite(row["atr_14"]) and row["atr_14"] > 0
        ) else np.nan

        if np.isfinite(extension_atr) and close > breakout_level and extension_atr > EXTENSION_ATR_THRESHOLD:
            return (regime, "IGNORE", "Too extended (>0.5 ATR above breakout)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        if atr_spiking:
            return (regime, "IGNORE", "ATR spiking (vol shock)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        # ATR collapsing is a RISK FLAG, not a veto. Allow but flag for closer monitoring

        dist = row["distance_to_55d_high_pct"]
        if dist <= DIST_READY:
            return (regime, "READY", f"{dist:.2f}% from 55D High", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        elif dist <= DIST_WATCH:
            return (regime, "WATCH", f"{dist:.2f}% away", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        else:
            return (regime, "IGNORE", f"{dist:.2f}% away (>3%)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)

    # ---------- Stocks ----------
    # Now support BOTH 20d and 55d breakouts for stocks
    high_20 = row["high_20"]
    high_55 = row["high_55"]
    low_20 = row["low_20"]
    
    # Primary: 20-day breakout (standard)
    breakout_level = high_20
    stop_level = max(breakout_level - (2 * row["atr_14"]), low_20)
    entry_trigger = calc_entry_trigger(breakout_level, atr)
    
    # Check if 55-day breakout is active (continuation breakout = stronger signal)
    dist_55 = row.get("distance_to_55d_high_pct", np.nan)
    is_55d_breakout = np.isfinite(dist_55) and dist_55 <= DIST_READY and close >= high_55 * 0.99

    # =============================================================
    # ATR SPIKE SENSITIVITY TUNING (Item 3.3)
    # =============================================================
    # ATR spiking should be a SOFT gate for strong stocks:
    # - HARD BLOCK: close < 200DMA (downtrend) - always IGNORE
    # - HARD BLOCK: close < 200DMA AND atr_spiking (weak + volatile)
    # - SOFT PASS: close > 200DMA AND atr_spiking AND +DI > -DI (strong but volatile)
    #              -> Allow to WATCH (not READY) to monitor
    # - HARD BLOCK: close > 200DMA AND atr_spiking AND -DI > +DI (volatile + weakening)
    #
    if close < ma200:
        return ("AVOID", "IGNORE", "Close<200DMA (downtrend)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
    
    atr_spike_soft_cap = False  # Flag: if True, cap READY→WATCH at the end
    if atr_spiking:
        # Check if stock is otherwise strong (+DI > -DI)
        adx_bullish = np.isfinite(plus_di) and np.isfinite(minus_di) and plus_di > minus_di
        if adx_bullish:
            # Strong stock with ATR spike - allow to WATCH but not READY (soft gate)
            atr_spike_soft_cap = True  # Will cap any READY → WATCH below
        else:
            # Weak stock with ATR spike - hard block
            return ("AVOID", "IGNORE", "ATR spiking + ADX bearish (volatile + weakening)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)

    if (close > ma200) and (ma50 > ma200) and (adx >= ADX_TREND_THRESHOLD):
        regime = "TREND"
    elif (close > ma200) and (adx < ADX_TREND_THRESHOLD):
        regime = "RANGE"  # Above 200DMA but weak trend
    else:
        regime = "RANGE"  # Fallback: close > ma200 but ma50 < ma200 (weakening)

    # --- ATR Spike Soft Cap helper ---
    # If atr_spike_soft_cap is set, cap READY→WATCH for this stock
    def _apply_atr_cap(result_tuple):
        if atr_spike_soft_cap and result_tuple[1] == "READY":
            return (result_tuple[0], "WATCH", result_tuple[2] + " [ATR spike soft cap]",
                    result_tuple[3], result_tuple[4], result_tuple[5], result_tuple[6])
        return result_tuple

    if regime == "TREND":
        extension_atr = ((close - breakout_level) / row["atr_14"]) if (
            np.isfinite(breakout_level) and np.isfinite(row["atr_14"]) and row["atr_14"] > 0
        ) else np.nan

        if np.isfinite(extension_atr) and close > breakout_level and extension_atr > EXTENSION_ATR_THRESHOLD:
            return (regime, "IGNORE", "Too extended (>0.5 ATR above breakout)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        # ATR collapsing is a RISK FLAG: allow entry but require stronger confirmation
        atr_collapse_risk = atr_collapsing and np.isfinite(row.get("atr_14", np.nan)) and row["atr_14"] > 0

        dist = row["distance_to_20d_high_pct"]

        # Volume confirmation for stocks
        vol_ratio = row.get("vol_ratio", np.nan)
        dollar_vol = row.get("dollar_vol_20", np.nan)
        
        # =============================================================
        # TIERED VOLUME GATES BY LIQUIDITY CLASS
        # =============================================================
        # Mega-caps don't need volume spikes to validate breakouts - the 
        # liquidity is inherent. Smaller stocks need more confirmation.
        #
        # LIQUIDITY TIERS:
        #   - Mega-cap (dollar_vol > $1B): 0.8x average (minimal confirmation)
        #   - Large-cap ($100M-$1B): 1.0x average (normal volume ok)
        #   - Mid/small-cap (<$100M): 1.2x average (require above-average)
        #
        # REGIME BONUS: In BULLISH regime, reduce thresholds by 0.2x
        # CHASING PENALTY: If chasing (dist > 1%), add 0.3x to requirement
        #
        market_regime_local = row.get("market_regime", "UNKNOWN")
        is_bullish_regime = (market_regime_local == "BULLISH")
        
        # Determine base volume threshold by liquidity class
        if np.isfinite(dollar_vol) and dollar_vol >= 1_000_000_000:  # $1B+
            base_vol_threshold = 0.8
            liquidity_class = "mega"
        elif np.isfinite(dollar_vol) and dollar_vol >= 100_000_000:  # $100M-$1B
            base_vol_threshold = 1.0
            liquidity_class = "large"
        else:  # <$100M or unknown
            base_vol_threshold = 1.2
            liquidity_class = "mid"
        
        # Apply regime bonus (bullish = easier)
        if is_bullish_regime:
            base_vol_threshold -= 0.2
        
        # Apply chasing penalty (further from breakout = harder)
        if dist > 1.0:
            base_vol_threshold += 0.3
        
        # Floor at 0.5x (don't accept extremely low volume)
        vol_threshold = max(0.5, base_vol_threshold)
        
        vol_ok = np.isfinite(vol_ratio) and vol_ratio >= vol_threshold
        vol_requirement = f"{vol_threshold:.1f}x ({liquidity_class})"
        
        
        # ATR collapsing requires tighter entry confirmation
        if atr_collapse_risk:
            # For collapsing ATR: require close > breakout AND vol_ratio >= 1.2
            atr_buffer = 0.1 * row.get("atr_14", np.nan)  # 10% of ATR buffer
            above_breakout = close > (breakout_level + atr_buffer) if np.isfinite(atr_buffer) else (close > breakout_level)
            if dist <= DIST_READY:
                if vol_ok and above_breakout:
                    return _apply_atr_cap((regime, "READY", f"{dist:.2f}% from 20D High (vol ok, ATR collapse tightened)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used))
                return (regime, "WATCH", f"{dist:.2f}% (ATR collapsing: needs stronger vol)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        
        if dist <= DIST_READY:
            if vol_ok:
                return _apply_atr_cap((regime, "READY", f"{dist:.2f}% from 20D High (vol {vol_requirement} ok)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used))
            return (regime, "WATCH", f"{dist:.2f}% from 20D High (need vol {vol_requirement})", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        elif dist <= DIST_WATCH:
            return (regime, "WATCH", f"{dist:.2f}% away", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        else:
            # Check 55d continuation breakout (stocks can also break 55d highs)
            if is_55d_breakout and vol_ok:
                # 55-day continuation breakout - use high_55 as breakout, low_20 as stop
                breakout_level_55 = high_55
                stop_level_55 = low_20  # Wider stop for continuation
                entry_trigger_55 = calc_entry_trigger(breakout_level_55, atr)
                return _apply_atr_cap((regime, "READY", f"55D continuation breakout (stronger trend)", breakout_level_55, stop_level_55, entry_trigger_55, atr_buffer_mult_used))
    # RANGE: Turtle-style (breakout-only, not mean-reversion)
    # Only allow breakout above high_20, not range-bottom entries
    # This avoids entry/risk calculation mismatch
    stop_level = row["low_20"]
    breakout_level = row["high_20"]  # Override: use high as entry
    entry_trigger = calc_entry_trigger(breakout_level, atr)
    
    # Check if close is above range (breakout mode)
    if close > breakout_level:
        # Breakout detected - require volume confirmation (same as TREND block)
        vol_ratio_rng = row.get("vol_ratio", np.nan)
        vol_ok_rng = np.isfinite(vol_ratio_rng) and vol_ratio_rng >= 0.8  # Relaxed threshold for range breakouts
        if vol_ok_rng:
            return _apply_atr_cap((regime, "READY", f"Range breakout above high_20 (vol {vol_ratio_rng:.1f}x ok)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used))
        else:
            return (regime, "WATCH", f"Range breakout above high_20 (need vol >= 0.8x)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
    else:
        # Still in range, or below - treat as WATCH only
        pos = row["range_position_20"]
        if pos <= RANGE_POSITION_BOTTOM:
            return (regime, "WATCH", f"Pos: {pos:.2f} (Range bottom - waiting for breakout)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        elif pos <= RANGE_POSITION_MID:
            return (regime, "WATCH", f"Pos: {pos:.2f} (Mid-range - waiting for breakout)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)
        else:
            return (regime, "WATCH", f"Pos: {pos:.2f} (Range top - wait for breakout or retest)", breakout_level, stop_level, entry_trigger, atr_buffer_mult_used)


def compute_exit_signal(row: dict) -> tuple[str, str]:
    """
    Compute exit signal for held positions.
    Uses active_stop (stateful) if available, otherwise falls back to stop_level.
    """
    if not row.get("is_held", False):
        return ("", "")

    close = row["close"]
    sleeve = row["sleeve"]

    if sleeve == "ETF_CORE":
        # ETFs use low_20 as stop
        etf_stop = row.get("active_stop", row["low_20"])
        if not np.isfinite(etf_stop):
            etf_stop = row["low_20"]
        if close < etf_stop:
            return ("SELL", f"ETF exit: close < stop ({etf_stop:.2f})")
        return ("HOLD", "No ETF exit trigger")

    # Stocks: use active_stop if available (stateful), else stop_level
    stop_level = row.get("active_stop", row.get("stop_level", np.nan))
    if not np.isfinite(stop_level):
        stop_level = float(row.get("stop_level", np.nan))
    
    if np.isfinite(stop_level) and close < stop_level:
        return ("SELL", f"Stock exit: close < stop ({stop_level:.2f})")
    return ("HOLD", "No stock exit trigger")


def compute_add_signals(row: dict, pos_state: dict) -> dict:
    """
    Optional pyramiding/adds (max configurable adds).
    
    TIER 1 FIX: Respects PYRAMIDING_ENABLED flag.
    If disabled, returns add_eligible=False and blank actions.
    
    Logic when enabled:
      - Only for held positions
      - Only in TREND regime
      - Add levels based on ATR from entry_price (configurable)
      - add1: entry + PYRAMID_ADD_1_ATR * ATR
      - add2: entry + PYRAMID_ADD_2_ATR * ATR
    """
    out = {
        "add_eligible": False,
        "add_level_1": np.nan,
        "add_level_2": np.nan,
        "add_action": "",
        "add_reason": "",
        "pyramiding_enabled": PYRAMIDING_ENABLED,  # Expose flag in output
    }

    # TIER 1 FIX: If pyramiding disabled, return immediately
    if not PYRAMIDING_ENABLED:
        out["add_reason"] = "PYRAMIDING_DISABLED"
        return out

    if not row.get("is_held", False):
        return out

    if row.get("regime") != "TREND":
        out["add_reason"] = "NOT_TREND_REGIME"
        return out

    t = str(row.get("ticker", "")).upper()
    if t not in pos_state:
        out["add_reason"] = "NO_POSITION_STATE"
        return out

    entry = pos_state[t].get("entry_price", np.nan)
    adds_taken = int(pos_state[t].get("adds_taken", 0))

    if not np.isfinite(entry):
        out["add_reason"] = "NO_ENTRY_PRICE"
        return out

    atr = float(row.get("atr_14", np.nan))
    if not np.isfinite(atr) or atr <= 0:
        out["add_reason"] = "NO_VALID_ATR"
        return out

    # Use configurable ATR levels
    lvl1 = entry + PYRAMID_ADD_1_ATR * atr
    lvl2 = entry + PYRAMID_ADD_2_ATR * atr

    out["add_eligible"] = True
    out["add_level_1"] = lvl1
    out["add_level_2"] = lvl2

    close = float(row.get("close", np.nan))
    if adds_taken >= PYRAMID_MAX_ADDS:
        out["add_action"] = "HOLD"
        out["add_reason"] = f"Max adds already taken ({PYRAMID_MAX_ADDS})"
        return out

    if adds_taken == 0 and close >= lvl1:
        out["add_action"] = "ADD"
        out["add_reason"] = f"Add #1 triggered (close >= entry + {PYRAMID_ADD_1_ATR}*ATR)"
    elif adds_taken == 1 and close >= lvl2:
        out["add_action"] = "ADD"
        out["add_reason"] = f"Add #2 triggered (close >= entry + {PYRAMID_ADD_2_ATR}*ATR)"
    else:
        out["add_action"] = "WAIT"
        out["add_reason"] = "No add trigger met"

    return out


def check_whipsaw_blocked(ticker: str, pos_state: dict, today_date: str) -> dict:
    """
    MODULE 11: Serial Whipsaw Kill Switch
    
    Check if a ticker is blocked due to repeated stop-hit exits.
    If a stock has been stopped out >= WHIPSAW_TRIGGER_COUNT times within
    WHIPSAW_MEMORY_DAYS, block re-entry for WHIPSAW_PENALTY_DAYS.
    
    Returns dict with whipsaw_blocked (bool) and whipsaw_reason (str).
    """
    out = {
        "whipsaw_blocked": False,
        "whipsaw_reason": "",
        "whipsaw_count": 0,
    }
    
    if not WHIPSAW_KILL_SWITCH_ENABLED:
        return out
    
    t = ticker.upper()
    if t not in pos_state:
        return out
    
    state = pos_state[t]
    whipsaw_count = state.get("whipsaw_count", 0)
    last_whipsaw_date = state.get("last_whipsaw_date", "")
    
    out["whipsaw_count"] = whipsaw_count
    
    if whipsaw_count < WHIPSAW_TRIGGER_COUNT or not last_whipsaw_date:
        return out
    
    # Check if still in penalty period
    try:
        whipsaw_dt = datetime.strptime(last_whipsaw_date, "%Y-%m-%d")
        today_dt = datetime.strptime(today_date[:10], "%Y-%m-%d")
        days_since_whipsaw = (today_dt - whipsaw_dt).days
        
        if days_since_whipsaw < WHIPSAW_PENALTY_DAYS:
            remaining = WHIPSAW_PENALTY_DAYS - days_since_whipsaw
            out["whipsaw_blocked"] = True
            out["whipsaw_reason"] = f"WHIPSAW BLOCKED: {whipsaw_count} stop-hits in {WHIPSAW_MEMORY_DAYS}d, {remaining}d penalty remaining"
            return out
        else:
            # Penalty expired - could reset count here, but we'll let it decay naturally
            out["whipsaw_reason"] = f"Whipsaw penalty expired ({days_since_whipsaw}d > {WHIPSAW_PENALTY_DAYS}d)"
    except Exception:
        pass  # If date parsing fails, don't block
    
    return out


def check_reentry_eligible(ticker: str, row: dict, pos_state: dict, today_date: str) -> dict:
    """
    Check if a ticker is eligible for re-entry after a profitable exit.
    
    Re-entry conditions:
    1. Was previously held and exited profitably (profit_R >= REENTRY_MIN_PROFIT_R)
    2. Cooldown period has passed (REENTRY_COOLDOWN_DAYS since exit)
    3. Price has made a new breakout (already handled by READY status)
    
    Returns dict with reentry_eligible and reentry_reason.
    """
    out = {
        "reentry_eligible": False,
        "reentry_reason": "",
        "last_exit_profit_R": np.nan,
    }
    
    if not REENTRY_ENABLED:
        return out
    
    t = ticker.upper()
    if t not in pos_state:
        return out
    
    state = pos_state[t]
    last_exit_date = state.get("last_exit_date", "")
    last_exit_profit_R = state.get("last_exit_profit_R", np.nan)
    
    # Must have exit history
    if not last_exit_date or not np.isfinite(last_exit_profit_R):
        return out
    
    out["last_exit_profit_R"] = last_exit_profit_R
    
    # Check profit threshold
    if last_exit_profit_R < REENTRY_MIN_PROFIT_R:
        out["reentry_reason"] = f"Exit profit too low ({last_exit_profit_R:.2f}R < {REENTRY_MIN_PROFIT_R}R)"
        return out
    
    # Check cooldown
    days_since_exit = None
    try:
        exit_dt = datetime.strptime(last_exit_date, "%Y-%m-%d")
        today_dt = datetime.strptime(today_date[:10], "%Y-%m-%d")
        days_since_exit = (today_dt - exit_dt).days
        if days_since_exit < REENTRY_COOLDOWN_DAYS:
            out["reentry_reason"] = f"Cooldown: {days_since_exit}d < {REENTRY_COOLDOWN_DAYS}d required"
            return out
    except (ValueError, TypeError):
        days_since_exit = None
        print(f"[WARN] {ticker}: malformed last_exit_date '{last_exit_date}' — reentry blocked")
    
    if days_since_exit is None:
        # Can't verify cooling-off period — block reentry as safety measure
        out["reentry_reason"] = "EXIT_DATE_INVALID"
        return out
    
    # Check whipsaw block (MODULE 11)
    whipsaw_info = check_whipsaw_blocked(ticker, pos_state, today_date)
    if whipsaw_info.get("whipsaw_blocked", False):
        out["reentry_reason"] = whipsaw_info["whipsaw_reason"]
        return out
    
    # Passed all checks
    out["reentry_eligible"] = True
    out["reentry_reason"] = f"Re-entry OK: +{last_exit_profit_R:.1f}R profit, {days_since_exit}d ago"
    return out


def compute_stateful_stop(row: dict, pos_state: dict, market_regime: str) -> dict:
    """
    Stateful stop logic + ADVANCED PROFIT PROTECTION using R (risk unit).
    
    ==========================================================================
    MODULE 1: ADVANCED PROFIT PROTECTION (The "Breakeven" Trigger)
    ==========================================================================
    Based on backtest analysis showing many STOP_HIT exits after trades were 
    profitable. This module protects open profits by moving stops up at key
    R-multiple thresholds.
    
    Rules:
    1) STATEFUL STOPS: stops only move up, never down
       active_stop = max(previous_active_stop, candidate_stop)
    
    2) PROFIT PROTECTION using R (configurable thresholds):
       R = entry_price - initial_stop (your risk unit per share)
       
       At +1.5R: active_stop = max(active_stop, entry_price) 
                 -> BREAKEVEN: eliminates possibility of loss
       
       At +3R:   active_stop = max(active_stop, entry_price + 1R)
                 -> LOCK +1R: guarantees profit even on reversal
       
       Beyond +3R: trailing = max(low_20, close - 2*ATR)
                 -> Aggressive trailing to capture trend continuation
    
    3) CHOP TIGHTENING (stocks only):
       When regime == CHOP: candidate_stop = max(candidate_stop, close - 1.5*ATR)
    
    Math Example:
      Entry = $100, Stop = $95 -> R = $5
      At close = $107.50 (+1.5R): move stop to $100 (breakeven)
      At close = $115 (+3R): move stop to $105 (+1R locked)
    
    Returns dict with updated stop columns and state updates.
    ==========================================================================
    """
    out = {
        "candidate_stop": np.nan,
        "active_stop": np.nan,
        "stop_reason": "",
        "profit_R": np.nan,
        "profit_protection_level": "",
        "initial_R": np.nan,
        "_state_update": None,  # Internal: new state to persist
    }
    
    if not row.get("is_held", False):
        return out
    
    t = str(row.get("ticker", "")).upper()
    close = float(row.get("close", np.nan))
    atr = float(row.get("atr_14", np.nan))
    low_20 = float(row.get("low_20", np.nan))
    sleeve = row.get("sleeve", "")
    
    if not np.isfinite(close):
        return out
    
    # Get previous state
    state = pos_state.get(t, {})
    entry_price = float(state.get("entry_price", np.nan))
    initial_stop = float(state.get("initial_stop", np.nan))
    previous_active_stop = float(state.get("active_stop", np.nan))
    
    # Default candidate stop from current row
    candidate_stop = float(row.get("stop_level", np.nan))
    
    # --- SIDEWAYS TIGHTENING (stocks only, ETFs keep normal trailing) ---
    if market_regime == "SIDEWAYS" and sleeve != "ETF_CORE":
        if np.isfinite(atr) and atr > 0:
            chop_tight_stop = close - (CHOP_ATR_TIGHTENING_MULT * atr)
            if np.isfinite(candidate_stop):
                candidate_stop = max(candidate_stop, chop_tight_stop)
            else:
                candidate_stop = chop_tight_stop
            out["stop_reason"] = "SIDEWAYS_TIGHTENED"
    
    out["candidate_stop"] = candidate_stop
    
    # --- ADVANCED PROFIT PROTECTION using R (Module 1) ---
    # Only apply if profit protection is enabled
    if PROFIT_PROTECTION_ENABLED and np.isfinite(entry_price) and np.isfinite(initial_stop):
        R = entry_price - initial_stop  # Risk per share in currency units
        out["initial_R"] = R
        
        if R > 0:
            profit = close - entry_price
            profit_R = profit / R  # How many R's of profit we have
            out["profit_R"] = profit_R
            
            # =============================================================
            # TIER 3: +3R or more -> LOCK +1R PROFIT + aggressive trailing
            # =============================================================
            # At +3R, we've more than doubled our initial risk in profit.
            # Lock in +1R (entry + R) and use tight trailing for the rest.
            if profit_R >= PROFIT_PROTECTION_LOCK_1R_THRESHOLD:
                # Minimum stop = entry + 1R (locks in profit regardless of reversal)
                lock_1r_stop = entry_price + R
                
                # Also compute aggressive trailing options
                trailing_options = [lock_1r_stop]  # Always include the +1R lock
                if np.isfinite(low_20):
                    trailing_options.append(low_20)
                if np.isfinite(atr) and atr > 0:
                    trailing_options.append(close - 2.0 * atr)
                
                # Pick tightest (highest) of all options
                profit_stop = max(trailing_options)
                if np.isfinite(candidate_stop):
                    candidate_stop = max(candidate_stop, profit_stop)
                else:
                    candidate_stop = profit_stop
                out["profit_protection_level"] = "3R_LOCK_1R_TRAILING"
                out["stop_reason"] = f"+{profit_R:.1f}R: lock +1R, trailing stop={candidate_stop:.2f}"
            
            # =============================================================
            # TIER 2.5: +2.5R -> LOCK +0.5R PROFIT (intermediate protection)
            # =============================================================
            # Prevents the common scenario: stock reaches +2.9R, reverses to
            # breakeven, exits at 0R — leaving 2.9R on the table. At +2.5R,
            # lock in at least +0.5R to guarantee some profit.
            elif profit_R >= PROFIT_PROTECTION_LOCK_HALF_R_THRESHOLD:
                lock_half_r_stop = entry_price + (0.5 * R)
                if np.isfinite(candidate_stop):
                    candidate_stop = max(candidate_stop, lock_half_r_stop)
                else:
                    candidate_stop = lock_half_r_stop
                out["profit_protection_level"] = "2.5R_LOCK_HALF_R"
                out["stop_reason"] = f"+{profit_R:.1f}R: lock +0.5R, stop={candidate_stop:.2f}"
            
            # =============================================================
            # TIER 2: +BE_TRIGGER_R -> BREAKEVEN protection (configurable)
            # =============================================================
            # Move stop to breakeven (entry price) with optional conditions.
            elif profit_R >= BE_TRIGGER_R:
                # TIER 2: Check BE conditions before moving to breakeven
                be_conditions_met = True
                be_block_reason = ""
                
                if BE_CONDITION_MODE == "trend_only":
                    # Only move to BE if in TREND regime and ADX >= threshold
                    adx = row.get("adx_14", np.nan)
                    regime = row.get("regime", "")
                    if regime != "TREND":
                        be_conditions_met = False
                        be_block_reason = f"BE blocked: regime={regime}, need TREND"
                    elif not np.isfinite(adx) or adx < BE_ADX_MIN:
                        be_conditions_met = False
                        be_block_reason = f"BE blocked: ADX={adx:.0f}, need >={BE_ADX_MIN}"
                        
                elif BE_CONDITION_MODE == "after_days":
                    # Only move to BE after MIN_HOLD_DAYS_FOR_BE
                    holding_days = row.get("holding_days", np.nan)
                    if not np.isfinite(holding_days) or holding_days < MIN_HOLD_DAYS_FOR_BE:
                        be_conditions_met = False
                        be_block_reason = f"BE blocked: held {holding_days:.0f}d, need {MIN_HOLD_DAYS_FOR_BE}d"
                
                if be_conditions_met:
                    if np.isfinite(candidate_stop):
                        candidate_stop = max(candidate_stop, entry_price)
                    else:
                        candidate_stop = entry_price
                    out["profit_protection_level"] = f"{BE_TRIGGER_R}R_BREAKEVEN"
                    out["stop_reason"] = f"+{profit_R:.1f}R: breakeven stop={candidate_stop:.2f}"
                else:
                    # Conditions not met - keep normal stop but log reason
                    out["profit_protection_level"] = f"BE_BLOCKED"
                    out["stop_reason"] = be_block_reason
            
            # =============================================================
            # Below BE_TRIGGER_R -> NORMAL stop (no profit protection yet)
            # =============================================================
            # Trade is profitable but not enough to justify breakeven move.
            # Keep using normal trailing stop logic.
    
    out["candidate_stop"] = candidate_stop
    
    # --- STATEFUL STOP (never loosen) ---
    # The golden rule: stops can only move UP (tighten), never DOWN (loosen).
    # This prevents whipsaws from moving our stop back down after it tightened.
    if np.isfinite(previous_active_stop):
        active_stop = max(previous_active_stop, candidate_stop) if np.isfinite(candidate_stop) else previous_active_stop
    else:
        active_stop = candidate_stop
    
    out["active_stop"] = active_stop
    
    if not out["stop_reason"]:
        if np.isfinite(previous_active_stop) and active_stop > candidate_stop:
            out["stop_reason"] = f"STATEFUL (kept higher prev stop)"
            print(f"  [STOP SAFETY] {t}: candidate_stop={candidate_stop:.4f} rejected, "
                  f"keeping higher prev_stop={previous_active_stop:.4f}")
        else:
            out["stop_reason"] = "NORMAL"
    
    # TIER 3: Detect NEW entry (held but no entry_price in state)
    is_new_entry = not np.isfinite(entry_price)
    
    # Use T212 avg_price for new entries
    entry_for_state = entry_price if np.isfinite(entry_price) else row.get("t212_avg_price", np.nan)
    
    # TIER 3: Preserve or set entry_date
    existing_entry_date = state.get("entry_date", "")
    entry_date_for_state = existing_entry_date if existing_entry_date else (
        date.today().isoformat() if is_new_entry else ""
    )
    
    # Prepare state update for persistence
    out["_state_update"] = {
        "ticker": t,
        "entry_price": entry_for_state,
        "initial_stop": initial_stop if np.isfinite(initial_stop) else row.get("stop_level", np.nan),
        "active_stop": active_stop,
        "adds_taken": state.get("adds_taken", 0),
        "entry_date": entry_date_for_state,
    }
    
    # TIER 3: Flag for fill sanity logging (caller will log)
    out["_is_new_entry"] = is_new_entry
    
    return out


def compute_market_regime(raw: pd.DataFrame, benchmark_yf: str, max_data_age_days: int, band_pct: float = 0.02, benchmark2_yf: str | None = None) -> dict:
    """
    Regime logic (mechanical):
      - Compute benchmark close vs 200DMA
      - If close > (1+band)*MA200 => BULLISH
      - If close < (1-band)*MA200 => BEARISH
      - Else => SIDEWAYS (with TIER 3 stability requirement)

    TIER 3: REGIME STABILITY
      - SIDEWAYS requires N consecutive days inside the band
      - Single-day touches don't flip regime to SIDEWAYS
      - Prevents regime flicker

    If benchmark2_yf is provided, we compute a second regime and combine:
      - BEARISH if either is BEARISH
      - BULLISH  if both are BULLISH
      - Otherwise SIDEWAYS/UNKNOWN
    """
    def one_regime(bm: str) -> dict:
        try:
            bdf = raw[bm].copy()
            if isinstance(bdf.columns, pd.MultiIndex):
                bdf.columns = bdf.columns.get_level_values(0)
            bdf = bdf.sort_index()

            base = bdf["Adj Close"] if "Adj Close" in bdf.columns else bdf["Close"]
            base = base.dropna()

            if base.empty or len(base) < 210:
                return {"regime": "UNKNOWN", "close": np.nan, "ma200": np.nan, "age_days": 999, "last_bar_date": "", "regime_stable": False, "days_in_chop_band": 0}

            last_bar = pd.Timestamp(base.index[-1]).tz_localize(None)
            now_utc = pd.Timestamp(datetime.now(timezone.utc)).tz_localize(None)
            age_days = (now_utc.normalize() - last_bar.normalize()).days

            if age_days > max_data_age_days:
                return {"regime": "UNKNOWN", "close": np.nan, "ma200": np.nan, "age_days": int(age_days), "last_bar_date": str(last_bar.date()), "regime_stable": False, "days_in_chop_band": 0}

            close = float(base.iloc[-1])
            ma200 = float(base.rolling(MA_200_PERIOD).mean().iloc[-1])

            if not (np.isfinite(close) and np.isfinite(ma200) and ma200 > 0):
                return {"regime": "UNKNOWN", "close": close, "ma200": ma200, "age_days": int(age_days), "last_bar_date": str(last_bar.date()), "regime_stable": False, "days_in_chop_band": 0}
            
            upper = (1.0 + float(band_pct)) * ma200
            lower = (1.0 - float(band_pct)) * ma200
            
            # TIER 3: Check regime stability for CHOP
            days_in_chop_band = 0
            regime_stable = True
            
            if REGIME_STABILITY_ENABLED:
                # Count consecutive days inside the CHOP band (from latest back)
                ma200_series = base.rolling(MA_200_PERIOD).mean()
                for i in range(1, min(REGIME_STABILITY_DAYS + 2, len(base))):
                    idx = -i
                    bar_close = float(base.iloc[idx])
                    bar_ma200 = float(ma200_series.iloc[idx])
                    if not np.isfinite(bar_ma200) or bar_ma200 <= 0:
                        break
                    bar_upper = (1.0 + float(band_pct)) * bar_ma200
                    bar_lower = (1.0 - float(band_pct)) * bar_ma200
                    if bar_lower <= bar_close <= bar_upper:
                        days_in_chop_band += 1
                    else:
                        break
            
            # Determine raw regime based on latest close
            if close >= upper:
                raw_regime = "BULLISH"
            elif close <= lower:
                raw_regime = "BEARISH"
            else:
                raw_regime = "SIDEWAYS"
            
            # TIER 3: Apply stability filter
            if raw_regime == "SIDEWAYS" and REGIME_STABILITY_ENABLED:
                if days_in_chop_band < REGIME_STABILITY_DAYS:
                    # Not stable yet - use directional regime based on position
                    if close > ma200:
                        regime = "BULLISH"
                        regime_stable = False
                    else:
                        regime = "BEARISH"
                        regime_stable = False
                else:
                    regime = "SIDEWAYS"
                    regime_stable = True
            else:
                regime = raw_regime
                regime_stable = True

            return {"regime": regime, "close": close, "ma200": ma200, "age_days": int(age_days), "last_bar_date": str(last_bar.date()), "regime_stable": regime_stable, "days_in_chop_band": days_in_chop_band}
        except Exception:
            return {"regime": "UNKNOWN", "close": np.nan, "ma200": np.nan, "age_days": 999, "last_bar_date": "", "regime_stable": False, "days_in_chop_band": 0}

    r1 = one_regime(benchmark_yf)
    out = {
        "market_regime": r1["regime"],
        "market_close": r1["close"],
        "market_ma200": r1["ma200"],
        "market_data_age_days": r1["age_days"],
        "market_last_bar_date": r1["last_bar_date"],
        "market_benchmark": benchmark_yf,
        "market_regime_stable": r1.get("regime_stable", True),
        "market_days_in_chop_band": r1.get("days_in_chop_band", 0),
    }

    if benchmark2_yf:
        r2 = one_regime(benchmark2_yf)
        out.update({
            "market2_regime": r2["regime"],
            "market2_close": r2["close"],
            "market2_ma200": r2["ma200"],
            "market2_data_age_days": r2["age_days"],
            "market2_last_bar_date": r2["last_bar_date"],
            "market_benchmark2": benchmark2_yf,
            "market2_regime_stable": r2.get("regime_stable", True),
        })

        # Combine regimes
        if (r1["regime"] == "UNKNOWN") or (r2["regime"] == "UNKNOWN"):
            out["market_regime"] = "UNKNOWN"
        elif (r1["regime"] == "BEARISH") or (r2["regime"] == "BEARISH"):
            out["market_regime"] = "BEARISH"
        elif (r1["regime"] == "BULLISH") and (r2["regime"] == "BULLISH"):
            out["market_regime"] = "BULLISH"
        else:
            out["market_regime"] = "SIDEWAYS"

    return out


def write_action_card(df: pd.DataFrame, out_path: Path, active_params: dict = None, sanity_warnings: list = None, positions_state: dict = None, exclude_sells: list[str] = None) -> None:
    """
    Writes a human-readable summary for weekend review.
    V5.8: Added parameter echo section and sanity warnings.
    """
    lines = []
    
    # --- TIMESTAMP ---
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines.append(f"# TURTLE Weekly Action Card")
    lines.append(f"**Generated:** {now_str}")
    lines.append("-" * 30)
    lines.append("")
    
    # --- PARAMETER ECHO SECTION ---
    if active_params:
        lines.append("## [CFG] Active Parameters")
        lines.append("")
        lines.append("| Category | Parameter | Value |")
        lines.append("|----------|-----------|-------|")
        lines.append(f"| **Risk** | Risk per Trade | {active_params.get('risk_per_trade_pct', 0)*100:.2f}% |")
        lines.append(f"| **Risk** | Max Open Risk (effective) | {active_params.get('effective_max_open_risk_pct', 0)*100:.1f}% |")
        lines.append(f"| **Risk** | Expansion Enabled | {'[OK] Yes' if active_params.get('max_open_risk_expansion_enabled') else '[X] No'} |")
        lines.append(f"| **Caps** | Mode | {active_params.get('cap_mode', 'UNKNOWN')} ({active_params.get('position_count', 0)} positions) |")
        lines.append(f"| **Caps** | Max Position (Core) | {active_params.get('max_position_pct_core', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Position (High-Risk) | {active_params.get('max_position_pct_high_risk', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Sleeve (Core) | {active_params.get('max_sleeve_core', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Sleeve (ETF) | {active_params.get('max_sleeve_etf', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Sleeve (High-Risk) | {active_params.get('max_sleeve_high_risk', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Cluster | {active_params.get('max_cluster_pct', 0)*100:.0f}% |")
        lines.append(f"| **Caps** | Max Super-Cluster | {active_params.get('max_supercluster_pct', 0)*100:.0f}% |")
        lines.append(f"| **ADX** | Trend Threshold | >={active_params.get('adx_trend_threshold', 0)} |")
        lines.append(f"| **ADX** | Direction Filter | {'[OK] +DI > -DI' if active_params.get('adx_direction_filter') else '[X] Off'} |")
        lines.append(f"| **ADX** | Expansion Trigger | >={active_params.get('adx_expansion_threshold', 0)} |")
        lines.append(f"| **Entry** | ATR Buffer | {active_params.get('atr_entry_buffer_mult', 0)*100:.0f}% |")
        lines.append(f"| **Entry** | DIST_READY | <={active_params.get('dist_ready_pct', 0):.1f}% |")
        lines.append(f"| **Entry** | DIST_WATCH | <={active_params.get('dist_watch_pct', 0):.1f}% |")
        lines.append(f"| **Exit** | CHOP Tightening | {active_params.get('chop_atr_tightening_mult', 0)}xATR |")
        lines.append(f"| **Re-entry** | Enabled | {'[OK] Yes' if active_params.get('reentry_enabled') else '[X] No'} |")
        lines.append(f"| **Regime** | Benchmarks | {active_params.get('benchmark', '')} + {active_params.get('benchmark2', '')} |")
        lines.append("")
    
    # --- SANITY WARNINGS ---
    if sanity_warnings:
        lines.append("## [!] Sanity Warnings")
        lines.append("")
        for warn in sanity_warnings:
            lines.append(f"- {warn}")
        lines.append("")
    
    if df.empty:
        lines.append("- No data available.")
        out_path.write_text("\n".join(lines), encoding="utf-8")
        return

    df = df.copy()
    if "rank_score" not in df.columns:
        # Fallback if add_rank_score wasn't called earlier
        df["rank_score"] = 999 

    # Identify Actions — exclude HEDGE (handled in isolated section below)
    hedge_mask = df.get("sleeve", pd.Series([""] * len(df))).astype(str).str.upper() == "HEDGE"
    sells_all = df[(df["is_held"] == True) & (df["held_action"] == "SELL") & ~hedge_mask]
    holds = df[(df["is_held"] == True) & (df["held_action"] == "HOLD") & ~hedge_mask]
    exclude_list = exclude_sells or []
    exclude_set = {str(t).strip().upper() for t in exclude_list if str(t).strip()}
    if exclude_set:
        exclude_mask = sells_all["ticker"].astype(str).str.upper().isin(exclude_set)
        sells = sells_all[~exclude_mask]
        sells_excluded = sells_all[exclude_mask]
    else:
        sells = sells_all
        sells_excluded = sells_all.iloc[0:0]

    # Candidate pools — exclude HEDGE
    ready_all = df[(df["is_held"] == False) & (df["status"] == "READY") & ~hedge_mask].copy()
    
    # Logic for Eligibility
    not_stale = (ready_all.get("data_age_days", 0) <= 5)
    market_ok = (ready_all.get("market_regime", "BULLISH") == "BULLISH")
    
    eligible_ready = ready_all[not_stale & market_ok & (ready_all.get("eligible_by_risk_caps", False))].copy()
    blocked_ready = ready_all[not_stale & market_ok & (~ready_all.get("eligible_by_risk_caps", False))].copy()

    eligible_ready = eligible_ready.sort_values("rank_score", ascending=True)
    blocked_ready = blocked_ready.sort_values("rank_score", ascending=True)

    # Risk summary
    open_risk_pct = df.get("open_risk_pct_total", pd.Series([np.nan])).iloc[0]
    risk_budget_rem = df.get("risk_budget_remaining_pct", pd.Series([np.nan])).iloc[0]

    # Market Regime Header (dual benchmark)
    mr = str(df.get("market_regime", pd.Series(["UNKNOWN"])).iloc[0])
    mr2 = str(df.get("market2_regime", pd.Series([""])).iloc[0]) if "market2_regime" in df.columns else ""
    bench1 = str(df.get("market_benchmark", pd.Series([""])).iloc[0]) if "market_benchmark" in df.columns else ""
    bench2 = str(df.get("market_benchmark2", pd.Series([""])).iloc[0]) if "market_benchmark2" in df.columns else ""
    
    # Count current positions (ex-HEDGE)
    held_positions = df[(df["is_held"] == True) & (df["sleeve"] != "HEDGE")]
    position_count = len(held_positions)
    
    lines.append(f"## [CHART] Portfolio Health")
    lines.append(f"- **Combined Regime: {mr}**")
    if mr2 and bench1 and bench2:
        lines.append(f"  - {bench1}: {df.get('market_regime', pd.Series(['?'])).iloc[0] if 'market_regime' not in df.columns else mr}")
        lines.append(f"  - {bench2}: {mr2}")
    # Calculate remaining budget in GBP for "unit blocked" display
    equity_gbp = df.get("t212_total_equity_gbp", pd.Series([0])).iloc[0]
    risk_budget_gbp = equity_gbp * risk_budget_rem if np.isfinite(risk_budget_rem) else 0.0
    
    if np.isfinite(open_risk_pct):
        lines.append(f"- Open Portfolio Risk: **{open_risk_pct*100:.2f}%**")
        lines.append(f"- Remaining Risk Budget: **{risk_budget_rem*100:.2f}%** (£{risk_budget_gbp:.2f})")
    
    # Position count with strong warning
    lines.append(f"- Open Positions (ex-HEDGE): **{position_count}** / {MAX_POSITIONS} max")
    if MAX_POSITIONS_WARN_ENABLED and position_count >= MAX_POSITIONS:
        lines.append(f"")
        lines.append(f"## [!] POSITION LIMIT WARNING")
        lines.append(f"**You have {position_count} positions open (max {MAX_POSITIONS}).**")
        lines.append(f"- Consider waiting for exits before adding new positions")
        lines.append(f"- This is a WARNING, not a hard block")
        lines.append(f"- Risk of over-diversification / reduced position sizing")
    lines.append("")

    lines.append("## [DN] Mandatory Sells (Monday close)")
    if not sells.empty:
        for _, r in sells.iterrows():
            stop_reason = r.get("stop_reason", "")
            profit_prot = r.get("profit_protection_level", "")
            extra = f" [{profit_prot}]" if profit_prot else ""
            lines.append(f"- **{r['ticker']}** - {r.get('held_action_reason', 'Sell signal')}{extra}")
    else:
        lines.append("- None")
    lines.append("")

    if exclude_set:
        lines.append("## [INFO] Excluded Sell List (Not in Mandatory Sells)")
        lines.append("_These tickers are excluded from the Mandatory Sells section but still evaluated._")
        lines.append("")
        excluded_rows = df[df["ticker"].astype(str).str.upper().isin(exclude_set) & ~hedge_mask]
        excluded_rows = excluded_rows.drop_duplicates(subset=["ticker"], keep="first")
        if not excluded_rows.empty or exclude_set:
            excluded_rows = excluded_rows.copy()
            excluded_rows["ticker_upper"] = excluded_rows["ticker"].astype(str).str.upper()

            for _, r in excluded_rows.sort_values("ticker_upper").iterrows():
                sell_flag = "YES" if str(r.get("held_action", "")).upper() == "SELL" else "NO"
                lines.append(f"- **{r['ticker']}** - Sell: {sell_flag}")

            seen = set(excluded_rows["ticker_upper"].tolist())
            missing = sorted([t for t in exclude_set if t not in seen])
            for t in missing:
                lines.append(f"- **{t}** - Sell: NO")
        else:
            lines.append("- None")
        lines.append("")

    # --- PYRAMID ADD SIGNALS (Monday execution) ---
    if PYRAMIDING_ENABLED and "add_action" in df.columns:
        pyramid_adds = df[(df["is_held"] == True) & (df["add_action"] == "ADD") & ~hedge_mask]
        if not pyramid_adds.empty:
            lines.append("## [UP] PYRAMID ADDS (Monday execution)")
            lines.append("_These held positions have moved enough in your favour to add another unit._")
            lines.append(f"_Turtle rule: add at +½N (½ ATR) intervals, max {PYRAMID_MAX_ADDS} adds per position._")
            lines.append("")
            for _, r in pyramid_adds.iterrows():
                ticker = r["ticker"]
                entry_price = r.get("entry_price", np.nan)
                close = r.get("close", np.nan)
                atr = r.get("atr_14", np.nan)
                add_reason = r.get("add_reason", "")
                profit_R = r.get("profit_R", np.nan)
                adds_taken = r.get("adds_taken", 0) if "adds_taken" in r.index else 0
                add_lvl_1 = r.get("add_level_1", np.nan)
                add_lvl_2 = r.get("add_level_2", np.nan)
                
                # Calculate sizing for the add unit
                eq = r.get("t212_total_equity_gbp", 0)
                risk_pct = r.get("risk_per_trade_pct_default", 0.0075)
                raw_new_stop = close - (2.0 * atr) if np.isfinite(atr) and np.isfinite(close) else np.nan
                # Turtle rule: stops only move up, never down — respect existing active_stop
                existing_stop = r.get("stop_level", np.nan)
                if np.isfinite(raw_new_stop) and np.isfinite(existing_stop):
                    new_stop = max(raw_new_stop, existing_stop)
                else:
                    new_stop = raw_new_stop
                rps_add = close - new_stop if np.isfinite(new_stop) else np.nan
                add_shares = int(eq * risk_pct / rps_add) if np.isfinite(rps_add) and rps_add > 0 and eq > 0 else 0
                
                lines.append(f"### {ticker} — ADD Unit #{int(adds_taken) + 1}")
                lines.append(f"- **Entry price (Unit 1):** {entry_price:.2f}")
                lines.append(f"- **Current price:** {close:.2f} ({profit_R:+.1f}R)")
                if np.isfinite(add_lvl_1):
                    lines.append(f"- **Add Level 1:** {add_lvl_1:.2f} (entry + {PYRAMID_ADD_1_ATR}×ATR)")
                if np.isfinite(add_lvl_2):
                    lines.append(f"- **Add Level 2:** {add_lvl_2:.2f} (entry + {PYRAMID_ADD_2_ATR}×ATR)")
                if np.isfinite(new_stop):
                    lines.append(f"- **New unit stop:** {new_stop:.2f}")
                if add_shares > 0:
                    lines.append(f"- **Sizing (est):** Buy {add_shares} shares")
                else:
                    lines.append(f"- **Sizing (est):** Insufficient budget for add")
                lines.append(f"- **Reason:** {add_reason}")
                lines.append(f"- **Important:** After adding, move stop for ALL units up to {new_stop:.2f}" if np.isfinite(new_stop) else "")
                lines.append("")
        else:
            # Show upcoming add levels for current holds
            eligible_adds = df[(df["is_held"] == True) & ~hedge_mask & (df.get("add_eligible", pd.Series([False])) == True) & (df.get("add_action", "") == "WAIT")]
            if not eligible_adds.empty:
                lines.append("## [CLOCK] PYRAMID LEVELS (Watching)")
                lines.append("_No add triggers yet — here are the levels to watch._")
                lines.append("")
                for _, r in eligible_adds.iterrows():
                    ticker = r["ticker"]
                    close = r.get("close", np.nan)
                    add_lvl_1 = r.get("add_level_1", np.nan)
                    add_lvl_2 = r.get("add_level_2", np.nan)
                    adds_taken = r.get("adds_taken", 0) if "adds_taken" in r.index else 0
                    
                    next_lvl = add_lvl_1 if adds_taken == 0 else add_lvl_2
                    dist = ((next_lvl - close) / close * 100) if np.isfinite(next_lvl) and np.isfinite(close) and close > 0 else np.nan
                    dist_str = f" ({dist:+.1f}% away)" if np.isfinite(dist) else ""
                    
                    lines.append(f"- **{ticker}**: Next add at {next_lvl:.2f}{dist_str} (adds taken: {int(adds_taken)}/{PYRAMID_MAX_ADDS})")
                lines.append("")

    # --- MODULE 3: LAGGARD SUGGESTIONS ---
    laggards = df[(df["is_held"] == True) & (df["is_laggard"] == True) & ~hedge_mask] if "is_laggard" in df.columns else pd.DataFrame()
    if not laggards.empty:
        lines.append("## TURTLEZZZ Laggard Positions (Consider Trimming)")
        lines.append("_These positions are held in loss for extended periods, tying up capital._")
        lines.append("_This is a **suggestion**, not a mandatory action. Review each case._")
        lines.append("")
        for _, r in laggards.iterrows():
            loss_pct = r.get("laggard_loss_pct", 0)
            holding_days = r.get("holding_days", 0)
            profit_R = r.get("profit_R", np.nan)
            entry_price = r.get("entry_price", np.nan)
            close = r.get("close", np.nan)
            lines.append(f"- **{r['ticker']}**: Held ~{holding_days:.0f} days, down {loss_pct:.1f}% ({profit_R:.1f}R)")
            lines.append(f"  - _Entry: {entry_price:.2f} -> Current: {close:.2f}_")
            lines.append(f"  - _Consider: Keep (strategic) / Trim (partial) / Close (redeploy capital)_")
        lines.append("")
    
    # --- MODULE 5: CLIMAX TOP EXITS (TIER 2: TRIM or TIGHTEN) ---
    climax_exits = df[(df["is_held"] == True) & (df.get("is_climax_exit", pd.Series([False])) == True) & ~hedge_mask] if "is_climax_exit" in df.columns else pd.DataFrame()
    if not climax_exits.empty:
        if CLIMAX_ACTION == "trim":
            lines.append(f"## [*] CLIMAX TOP - TRIM {int(CLIMAX_TRIM_PCT*100)}% (Take Partial Profits)")
            lines.append("_These positions are showing 'blow-off top' signals - parabolic extension + climax volume._")
            lines.append(f"_Consider trimming {int(CLIMAX_TRIM_PCT*100)}% and letting the rest ride with tighter stop._")
        else:
            lines.append("## [*] CLIMAX TOP - TIGHTEN STOP")
            lines.append("_These positions are showing 'blow-off top' signals - parabolic extension + climax volume._")
            lines.append(f"_Tighten stop to close - {CLIMAX_ATR_TIGHTEN_MULT}×ATR to protect gains._")
        lines.append("")
        for _, r in climax_exits.iterrows():
            ma_ext = r.get("ma_extension_pct", 0) * 100
            vol_ratio = r.get("vol_ratio", 0)
            profit_R = r.get("profit_R", np.nan)
            atr = r.get("atr_14", np.nan)
            close = r.get("close", np.nan)
            lines.append(f"- **{r['ticker']}**: +{ma_ext:.0f}% above MA20, volume {vol_ratio:.1f}x avg")
            if CLIMAX_ACTION == "trim":
                lines.append(f"  - _Current Profit: {profit_R:.1f}R - TRIM {int(CLIMAX_TRIM_PCT*100)}%_")
            else:
                tight_stop = close - (CLIMAX_ATR_TIGHTEN_MULT * atr) if np.isfinite(atr) and np.isfinite(close) else np.nan
                lines.append(f"  - _Current Profit: {profit_R:.1f}R - TIGHTEN STOP to {tight_stop:.2f}_")
        lines.append("")
    
    # --- MODULE 7: SWAP SUGGESTIONS ---
    swaps = df[(df["is_held"] == True) & (df.get("is_swap_candidate", pd.Series([False])) == True) & ~hedge_mask] if "is_swap_candidate" in df.columns else pd.DataFrame()
    if not swaps.empty:
        lines.append("## [SYNC] SWAP SUGGESTIONS (Upgrade Quality)")
        lines.append("_These holdings could be swapped for higher-momentum candidates in the same cluster._")
        lines.append("")
        for _, r in swaps.iterrows():
            swap_ticker = r.get("swap_for_ticker", "")
            swap_reason = r.get("swap_reason", "")
            lines.append(f"- **{r['ticker']}** -> Swap for **{swap_ticker}**")
            lines.append(f"  - _{swap_reason}_")
        lines.append("")
    lines.append("")

    # --- MODULE 6: PRIORITY ENTRIES (RS Leaders) ---
    priority = df[(df.get("is_priority_entry", pd.Series([False])) == True) & ~hedge_mask] if "is_priority_entry" in df.columns else pd.DataFrame()
    if not priority.empty:
        lines.append("## [#1] RS LEADERS (Priority Entry)")
        lines.append("_These stocks are significantly outperforming the benchmark - potential new market leaders._")
        lines.append("")
        for _, r in priority.iterrows():
            rs = r.get("rs_vs_benchmark", 0) * 100
            status = r.get("status", "")
            reason = r.get("priority_entry_reason", "")
            te = r.get("trend_efficiency", np.nan)
            te_str = f", Efficiency: {te:.0%}" if np.isfinite(te) else ""
            lines.append(f"- **{r['ticker']}** ({status}): RS +{rs:.1f}% vs benchmark{te_str}")
        lines.append("")

    lines.append("## [*] Eligible READY Shortlist")
    
    # TIER 1: Add Monday execution rule header
    if EXEC_GUARD_ENABLED:
        lines.append("")
        lines.append("> **MONDAY RULE**: Only buy if Monday price ≤ trigger*(1+{:.0f}%) AND (price-trigger)/ATR ≤ {:.2f}".format(
            EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER * 100, EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER))
        lines.append("")
    
    if not eligible_ready.empty:
        for _, r in eligible_ready.head(5).iterrows():
            lines.append(f"### {r['ticker']}")
            entry_trigger = r.get("entry_trigger", r.get("breakout_level", np.nan))
            lines.append(f"- **Entry Trigger:** Close > {entry_trigger:.2f} (breakout + ATR buffer)")
            lines.append(f"- **Breakout Level:** {r['breakout_level']:.2f}")
            lines.append(f"- **Stop Loss:** {r['stop_level']:.2f}")
            # Use the sizing calculation from our Sizing Fix
            rps = r.get("risk_per_share_gbp_est", 0)
            eq = r.get("t212_total_equity_gbp", 0)
            risk_pct = r.get("risk_per_trade_pct_default", 0.0075)
            if rps > 0 and eq > 0:
                shares = (eq * risk_pct) / rps
                # Use actual remaining budget for sizing, not standard risk_per_trade
                budget_shares = risk_budget_gbp / rps if rps > 0 else 0
                int_shares = int(budget_shares)
                
                lines.append(f"- **Risk per Share:** £{rps:.2f}")
                
                if int_shares >= 1:
                    lines.append(f"- **Sizing (est):** Buy {int_shares} shares [OK]")
                else:
                    # UNIT BLOCKED - budget exists but < 1 share
                    lines.append(f"- **Sizing (est):** 0 shares [!] **UNIT BLOCKED**")
                    lines.append(f"  - _Budget £{risk_budget_gbp:.2f} < £{rps:.2f} needed for 1 share_")
                    lines.append(f"  - _Great setup, but position too expensive for current risk budget_")
            
            # Show currency and FX info for transparency
            ccy = r.get('currency', '')
            fx_reason = r.get('fx_reason', '')
            fx_rate = r.get('fx_to_gbp_est', 1.0)
            if ccy and fx_reason:
                lines.append(f"- **Currency:** {ccy} (FX: {fx_rate:.4f}, {fx_reason})")
            
            lines.append(f"- **Reason:** {r.get('reason', 'Breakout signal')}")
            
            # MODULE 4: Trend Efficiency indicator
            te = r.get("trend_efficiency", np.nan)
            if np.isfinite(te):
                te_emoji = "[OK]" if te >= TREND_EFFICIENCY_BOOST_THRESHOLD else "[!]" if te < TREND_EFFICIENCY_PENALTY_THRESHOLD else "[*]"
                lines.append(f"- **Trend Efficiency:** {te:.0%} {te_emoji}")
            
            # MODULE 6: RS indicator
            rs = r.get("rs_vs_benchmark", np.nan)
            if np.isfinite(rs):
                rs_emoji = "[^]" if rs > 0.1 else "[UP]" if rs > 0 else "[DN]"
                lines.append(f"- **RS vs Benchmark:** {rs*100:+.1f}% {rs_emoji}")
            
            lines.append("")
    else:
        lines.append("- No eligible candidates this week.")
    lines.append("")

    # --- TIER 1: EXECUTION GUARD BLOCKED ---
    if EXEC_GUARD_ENABLED and "exec_guard_pass" in df.columns:
        exec_blocked = df[(df["is_held"] == False) & 
                          (df["status"] == "READY") & 
                          (df["exec_guard_pass"] == False)].copy()
        if not exec_blocked.empty:
            lines.append("## [CLOCK] READY but SKIP (Too Extended for Monday)")
            lines.append("_These candidates gapped up or extended beyond safe entry thresholds._")
            lines.append(f"_Execution guard: Max ATR above trigger = {EXEC_GUARD_MAX_ATR_ABOVE_TRIGGER}x, Max % above = {EXEC_GUARD_MAX_PCT_ABOVE_TRIGGER*100:.1f}%_")
            lines.append("")
            for _, r in exec_blocked.head(10).iterrows():
                reason = r.get("exec_guard_reason", "Too extended")
                atr_above = r.get("extension_atr_above_trigger", np.nan)
                pct_above = r.get("extension_pct_above_trigger", np.nan)
                entry_trigger = r.get("entry_trigger", np.nan)
                close_price = r.get("close", np.nan)
                lines.append(f"- **{r['ticker']}**: {reason}")
                if np.isfinite(atr_above) and np.isfinite(pct_above):
                    lines.append(f"  - _Trigger: {entry_trigger:.2f} | Close: {close_price:.2f} | +{atr_above:.1f}x ATR (+{pct_above*100:.1f}%)_")
                lines.append(f"  - _Action: Wait for pullback or next setup cycle_")
            lines.append("")

    lines.append("## [X] READY but GATE BLOCKED (Risk Caps)")
    lines.append("_These are blocked by risk limits - the system must not enter._")
    lines.append("")
    if not blocked_ready.empty:
        lines.append("### Why are these blocked? (Learn as you go)")
        lines.append("")
        for _, r in blocked_ready.head(10).iterrows():
            reason = r.get("risk_caps_block_reason", "Max exposure reached")
            ticker = r['ticker']
            sleeve = r.get('sleeve', 'UNKNOWN')
            lines.append(f"**{ticker}** ({sleeve})")
            
            # Add detailed explanation based on block reason
            if "BLOCK_MAX_SLEEVE_ETF" in reason:
                sleeve_pct = r.get("sleeve_value_pct", 0.0)
                lines.append(f"- Block: ETF_CORE sleeve is at {sleeve_pct*100:.1f}% of portfolio (max 40%)")
                lines.append(f"- Learn: Sleeve concentration limits prevent over-concentration in one strategy")
                lines.append(f"- Action: Close an existing ETF or wait for exits")
            elif "BLOCK_MAX_SLEEVE_CORE" in reason:
                sleeve_pct = r.get("sleeve_value_pct", 0.0)
                lines.append(f"- Block: STOCK_CORE sleeve is at {sleeve_pct*100:.1f}% of portfolio (max 50%)")
                lines.append(f"- Learn: Sleeve concentration limits prevent systemic risk concentration")
                lines.append(f"- Action: Close a stock position or wait for exits")
            elif "BLOCK_MAX_SLEEVE_HIGH_RISK" in reason:
                sleeve_pct = r.get("sleeve_value_pct", 0.0)
                lines.append(f"- Block: STOCK_HIGH_RISK sleeve is at {sleeve_pct*100:.1f}% of portfolio (max 20%)")
                lines.append(f"- Learn: Aggressive positions require tighter concentration limits")
                lines.append(f"- Action: Close a high-risk position or wait for exits")
            elif "BLOCK_MAX_CLUSTER" in reason:
                cluster = r.get("cluster", "UNKNOWN")
                cluster_pct = r.get("cluster_risk_pct", 0.0)
                lines.append(f"- Block: {cluster} sector is at {cluster_pct*100:.1f}% open risk (concentration cap)")
                lines.append(f"- Learn: Sector concentration limits prevent single-sector concentration risk")
                lines.append(f"- Action: Close a position in this sector or diversify")
            elif "BLOCK_SUPERCLUSTER_RISK" in reason:
                supercluster = r.get("super_cluster", "UNKNOWN")
                scr = r.get("super_cluster_risk_pct", 0.0)
                lines.append(f"- Block: {supercluster} super-cluster is at {scr*100:.1f}% open risk (max 20%)")
                lines.append(f"- Learn: Thematic concentration (e.g., Tech sector) limits systemic risk")
                lines.append(f"- Action: Exit or wait for positions in this thematic area")
            elif "BLOCK_MAX_POSITION_SIZE" in reason:
                pos_pct = r.get("position_size_pct", 0.0)
                max_pct = 0.15 if sleeve != "STOCK_HIGH_RISK" else 0.10
                lines.append(f"- Block: Position would be {pos_pct*100:.1f}% of equity (max {max_pct*100:.0f}%)")
                lines.append(f"- Learn: Position sizing limits prevent single-position domination")
                lines.append(f"- Action: Reduce equity allocation or wait for portfolio adjustments")
            elif "BLOCK_MAX_OPEN_RISK" in reason:
                open_risk = r.get("open_risk_pct_ex_hedge", 0.0)
                max_risk = r.get("effective_max_open_risk_pct", 0.055)
                new_risk = r.get("risk_per_trade_pct", 0.0075)
                lines.append(f"- Block: Open risk would be {(open_risk + new_risk)*100:.2f}% (max {max_risk*100:.2f}%)")
                lines.append(f"- Learn: Open risk caps control portfolio volatility and drawdown")
                lines.append(f"- Action: Exit positions to free up risk budget")
            elif "NO_EQUITY_FOR_RISK_BUDGET" in reason:
                lines.append(f"- Block: Cannot calculate risk (missing equity data)")
                lines.append(f"- Learn: Risk calculation requires valid equity valuation")
                lines.append(f"- Action: Check data integrity or recalculate")
            else:
                lines.append(f"- Block: {reason}")
                lines.append(f"- Learn: Portfolio constraints prevent new entries")
                lines.append(f"- Action: Review risk caps and exit criteria")
            lines.append("")
    else:
        lines.append("- None - all READY candidates are eligible!")
    lines.append("")

    lines.append("## [*] Current Holdings Audit")
    held = df[(df["is_held"] == True) & (df["sleeve"] != "HEDGE")]
    if not held.empty:
        for _, r in held.iterrows():
            profit_R = r.get("profit_R", np.nan)
            profit_prot = r.get("profit_protection_level", "")
            stop_reason = r.get("stop_reason", "")
            is_laggard = r.get("is_laggard", False)
            
            # Build status string
            status_parts = []
            if np.isfinite(profit_R):
                status_parts.append(f"Profit: {profit_R:.1f}R")
            if profit_prot:
                status_parts.append(f"[SHIELD] {profit_prot}")
            if stop_reason and "STATEFUL" in stop_reason:
                status_parts.append("[LOCK] Stateful")
            if is_laggard:
                status_parts.append("ZZZ LAGGARD")
            
            # Pyramid status
            add_action = r.get("add_action", "")
            adds_taken = int(r.get("adds_taken", 0)) if "adds_taken" in r.index else 0
            if PYRAMIDING_ENABLED and add_action == "ADD":
                status_parts.append(f"[UP] ADD #{adds_taken + 1} READY")
            elif PYRAMIDING_ENABLED and adds_taken > 0:
                status_parts.append(f"Units: {adds_taken + 1}")
            
            status_str = f" ({', '.join(status_parts)})" if status_parts else ""
            lines.append(f"- **{r['ticker']}**: Stop at {r['stop_level']:.2f}{status_str}")
    else:
        lines.append("- No active positions.")

    # --- TIER 3: SYSTEM HEALTH / TURNOVER MONITOR ---
    # BUG FIX A: Use dataframe count for active positions (more accurate than positions_state)
    actual_active_count = len(df[df["is_held"] == True])
    if positions_state:
        try:
            turnover = compute_turnover_stats(positions_state, lookback_days=30)
            lines.append("")
            lines.append("## [CHART] System Health")
            lines.append(f"- **Trades (last 30d):** {turnover.get('trades_last_N_days', 0)}")
            avg_hold = turnover.get("avg_holding_days")
            if avg_hold is not None:
                lines.append(f"- **Avg Holding Days:** {avg_hold:.0f} days")
            # Use actual dataframe count, not positions_state count
            lines.append(f"- **Active Positions:** {actual_active_count}")
            oldest = turnover.get("oldest_position_days", 0)
            if oldest > 0:
                lines.append(f"- **Oldest Position:** {oldest} days")
            lines.append("")
        except Exception as e:
            lines.append(f"\n_[Turnover stats unavailable: {e}]_")

    # =====================================================================
    # HEDGE PORTFOLIO — fully isolated section
    # =====================================================================
    hedge_df = df[hedge_mask].copy()
    if not hedge_df.empty:
        lines.append("---")
        lines.append("")
        lines.append("## [SHIELD] HEDGE Portfolio (Isolated)")
        lines.append("_Long-term / defensive positions. Excluded from all main gates, risk budget, and position counts._")
        lines.append("")

        # Hedge Sells
        hedge_sells = hedge_df[(hedge_df["is_held"] == True) & (hedge_df["held_action"] == "SELL")]
        lines.append("### Hedge — Sell Signals")
        if not hedge_sells.empty:
            for _, r in hedge_sells.iterrows():
                reason = r.get("held_action_reason", "Sell signal")
                profit_R = r.get("profit_R", np.nan)
                pR = f" ({profit_R:+.1f}R)" if np.isfinite(profit_R) else ""
                lines.append(f"- **{r['ticker']}** — {reason}{pR}")
                lines.append(f"  - Stop: {r['stop_level']:.2f} | Close: {r.get('close', np.nan):.2f}")
        else:
            lines.append("- None")
        lines.append("")

        # Hedge Holds
        hedge_holds = hedge_df[(hedge_df["is_held"] == True) & (hedge_df["held_action"] != "SELL")]
        lines.append("### Hedge — Current Holdings")
        if not hedge_holds.empty:
            for _, r in hedge_holds.iterrows():
                profit_R = r.get("profit_R", np.nan)
                pR = f"Profit: {profit_R:+.1f}R" if np.isfinite(profit_R) else ""
                profit_prot = r.get("profit_protection_level", "")
                prot_str = f", [SHIELD] {profit_prot}" if profit_prot else ""
                stop_reason = r.get("stop_reason", "")
                stateful = ", [LOCK] Stateful" if stop_reason and "STATEFUL" in stop_reason else ""
                status_str = f" ({pR}{prot_str}{stateful})" if (pR or prot_str or stateful) else ""
                lines.append(f"- **{r['ticker']}**: Stop at {r['stop_level']:.2f}{status_str}")
                close = r.get("close", np.nan)
                entry = r.get("entry_price", np.nan)
                if np.isfinite(close) and np.isfinite(entry):
                    chg = (close - entry) / entry * 100
                    lines.append(f"  - Entry: {entry:.2f} | Close: {close:.2f} | P&L: {chg:+.1f}%")
        else:
            lines.append("- None")
        lines.append("")

        # Hedge Buy Candidates (not held, READY)
        hedge_candidates = hedge_df[(hedge_df["is_held"] == False) & (hedge_df["status"] == "READY")]
        lines.append("### Hedge — Buy Candidates")
        if not hedge_candidates.empty:
            for _, r in hedge_candidates.iterrows():
                entry_trigger = r.get("entry_trigger", r.get("breakout_level", np.nan))
                lines.append(f"- **{r['ticker']}**")
                if np.isfinite(entry_trigger):
                    lines.append(f"  - Entry Trigger: {entry_trigger:.2f}")
                lines.append(f"  - Breakout: {r.get('breakout_level', np.nan):.2f} | Stop: {r['stop_level']:.2f}")
                lines.append(f"  - Reason: {r.get('reason', 'Breakout signal')}")
        else:
            lines.append("- None")
        lines.append("")

        # Hedge Not-Ready (watching)
        hedge_watching = hedge_df[(hedge_df["is_held"] == False) & (hedge_df["status"] != "READY")]
        if not hedge_watching.empty:
            lines.append("### Hedge — Watchlist (Not Ready)")
            for _, r in hedge_watching.head(10).iterrows():
                status = r.get("status", "")
                close = r.get("close", np.nan)
                brk = r.get("breakout_level", np.nan)
                dist = ((close - brk) / brk * 100) if np.isfinite(close) and np.isfinite(brk) and brk > 0 else np.nan
                dist_str = f" ({dist:+.1f}% from breakout)" if np.isfinite(dist) else ""
                lines.append(f"- **{r['ticker']}** [{status}]{dist_str}")
            lines.append("")

        # Hedge Risk Summary
        hedge_risk_gbp = hedge_df.get("hedge_risk_gbp", pd.Series([0])).iloc[0]
        hedge_risk_pct = hedge_df.get("hedge_risk_pct", pd.Series([0])).iloc[0]
        hedge_held_count = len(hedge_df[hedge_df["is_held"] == True])
        lines.append(f"### Hedge — Risk Summary")
        lines.append(f"- Hedge Positions Held: **{hedge_held_count}**")
        if np.isfinite(hedge_risk_pct):
            lines.append(f"- Hedge Open Risk: **{hedge_risk_pct*100:.2f}%** (£{hedge_risk_gbp:.2f})")
        lines.append("")

    lines.append("\n> Follow the close. No midweek overrides. Stops only move UP, never down.")
    
    # Save the file with emojis restored for markdown
    content = "\n".join(lines)
    content = restore_emojis_for_markdown(content)
    out_path.write_text(content, encoding="utf-8")

# ----------------------------
# Universe Hygiene / Risk Helpers
# ----------------------------

# HEDGE has highest priority (0) so it wins if a ticker is in multiple lists
# This ensures HEDGE positions are always treated as HEDGE, not ETF/STOCK
SLEEVE_PRIORITY = {"HEDGE": 0, "ETF_CORE": 1, "STOCK_CORE": 2, "STOCK_HIGH_RISK": 3}

def enforce_unique_underlyings(dfu: pd.DataFrame) -> tuple[pd.DataFrame, list[dict]]:
    """
    Enforce uniqueness by ticker_yf across sleeves (prevents double-counting).
    Keeps the highest-priority sleeve per ticker_yf (HEDGE > ETF_CORE > STOCK_CORE > STOCK_HIGH_RISK).
    Returns: (filtered_df, dropped_log)
    """
    if dfu.empty:
        return dfu, []

    dfu = dfu.copy()
    dfu["__prio"] = dfu["sleeve"].map(SLEEVE_PRIORITY).fillna(99).astype(int)

    dropped = []
    keep_rows = []

    for tyf, g in dfu.groupby("ticker_yf", dropna=False):
        g = g.sort_values("__prio")
        keep = g.iloc[0]
        keep_rows.append(keep)

        if len(g) > 1:
            for _, r in g.iloc[1:].iterrows():
                dropped.append({
                    "ticker_yf": tyf,
                    "kept_sleeve": str(keep["sleeve"]),
                    "dropped_sleeve": str(r["sleeve"]),
                    "ticker": str(r.get("ticker", "")),
                })

    out = pd.DataFrame(keep_rows).drop(columns=["__prio"], errors="ignore")
    return out.reset_index(drop=True), dropped


def estimate_fx_to_gbp(row: pd.Series) -> float:
    """
    Estimate FX to GBP using T212 snapshot if available:
      fx_to_gbp ~= value_gbp / (qty * current_price_local)
    For GBX/GBp instruments, the quote is in pence. The math naturally returns ~0.01.
    """
    try:
        qty = float(row.get("t212_quantity", np.nan))
        val_gbp = float(row.get("t212_position_value", np.nan))
        px = float(row.get("t212_current_price", np.nan))
        ccy = str(row.get("t212_currency", "") or "").upper()

        if not (np.isfinite(qty) and qty > 0 and np.isfinite(val_gbp) and val_gbp > 0 and np.isfinite(px) and px > 0):
            return np.nan

        # For GBX/GBp instruments, the quote is in pence.
        # We want a multiplier that converts quote-units to GBP.
        # value_gbp / (qty * px) naturally returns ~0.01 (GBP per penny).
        # So we DO NOT divide px by 100 here - let the math work naturally.
        if ccy in ("GBX", "GBPENCE", "GBp"):
            pass  # Don't adjust - let fx calculation reflect pence correctly

        denom = qty * px
        if denom <= 0:
            return np.nan
        return float(val_gbp / denom)
    except Exception:
        return np.nan

def compute_risk_caps_block_reason(row: dict, total_equity_gbp: float, max_open_risk_pct: float, 
                                   max_cluster_pct: float, max_position_pct: float,
                                   max_supercluster_pct: float = 0.20) -> str:
    """
    Compute HARD BLOCK reason (prevents entry).
    Returns non-empty string or "" if eligible.
    Hard blocks: already held, cluster cap, super-cluster cap, position size cap.
    NOTE: Position count and open risk budget are WARNINGS (see compute_risk_warning_reason).
    """
    # Check if position is already held - block new entry (pyramiding handled separately)
    if bool(row.get("is_held", False)):
        pyramiding_enabled = bool(row.get("pyramiding_enabled", False))
        add_eligible = bool(row.get("add_eligible", False))
        if pyramiding_enabled and add_eligible:
            return ""  # Can add via pyramiding, not blocked
        else:
            return "ALREADY_HELD"
    
    status = str(row.get("status", "")).upper()
    if status != "READY":
        return ""
    
    risk_per_trade = row.get("risk_per_trade_pct_default", 0.055)
    
    # NOTE: Position count and open risk budget are WARNINGS, not hard blocks.
    # A small discretionary account should see the constraint but retain the
    # ability to override.  See compute_risk_warning_reason() for these checks.
    
    # 1. Cluster concentration block (held risk)
    cluster_risk_pct = row.get("cluster_risk_pct", np.nan)
    if np.isfinite(cluster_risk_pct) and ((cluster_risk_pct + risk_per_trade) > max_cluster_pct):
        return f"BLOCK_MAX_CLUSTER_{row.get('cluster', 'UNKNOWN')}"
    
    # 2. Super-cluster block (thematic concentration)
    sc_risk_pct = row.get("super_cluster_risk_pct", np.nan)
    if np.isfinite(sc_risk_pct) and ((sc_risk_pct + risk_per_trade) > max_supercluster_pct):
        return f"BLOCK_MAX_SUPERCLUSTER_{row.get('super_cluster', 'UNKNOWN')}"
    
    # 3. Actual position size block (for held positions)
    actual_pct = row.get("position_pct_of_equity", 0.0)
    if actual_pct > max_position_pct:
        return f"BLOCK_MAX_POSITION_ACTUAL_{actual_pct*100:.1f}pct"
    
    # 4. Projected position size - NO LONGER A BLOCK with fractional shares (Trading 212)
    # With fractional shares, you can buy ANY amount - just risk less than target risk%.
    # This is now a WARNING, not a block. The position will be capped at max_position_pct.
    # projected_pct = row.get("projected_position_pct_est", 0.0)
    # if projected_pct > max_position_pct:
    #     return f"BLOCK_MAX_POSITION_PROJECTED_{projected_pct*100:.1f}pct"
    
    return ""


def compute_risk_warning_reason(row: dict, total_equity_gbp: float, max_open_risk_pct: float,
                               max_sleeve_pct: float = 0.50, max_position_pct: float = 0.18) -> str:
    """
    Compute WARNING reason (does NOT prevent entry).
    Returns non-empty string or "" if no warnings.
    Warnings: open risk budget, sleeve concentration.
    """
    if bool(row.get("is_held", False)):
        return ""
    
    status = str(row.get("status", "")).upper()
    if status != "READY":
        return ""
    
    warnings = []
    
    # 0. Position count warning (respect effective_max_positions from breadth)
    effective_max_pos = row.get("effective_max_positions", 99)
    position_count = row.get("position_count_ex_hedge", 0)
    if np.isfinite(effective_max_pos) and np.isfinite(position_count):
        if int(position_count) >= int(effective_max_pos):
            warnings.append(f"WARN_MAX_POSITIONS_{int(position_count)}_of_{int(effective_max_pos)}")
    
    # 1. Open risk budget gate (WARNING ONLY - allows entry but signals risk)
    open_risk = row.get("open_risk_pct_ex_hedge", 0.0)
    risk_per_trade = row.get("risk_per_trade_pct_default", 0.055)
    effective_max = row.get("effective_max_open_risk_pct", max_open_risk_pct)
    
    if np.isfinite(open_risk) and (open_risk + risk_per_trade) > effective_max:
        warnings.append(f"WARN_OPEN_RISK_BUDGET_{(open_risk+risk_per_trade)*100:.1f}pct_vs_{effective_max*100:.1f}pct_cap")
    
    # 2. Sleeve concentration warning
    sleeve_pct = row.get("sleeve_value_pct", 0.0)
    if np.isfinite(sleeve_pct) and (sleeve_pct + risk_per_trade) > max_sleeve_pct:
        warnings.append(f"WARN_SLEEVE_EXPOSURE_{row.get('sleeve', 'UNKNOWN')}")
    
    # 3. Position size warning (fractional shares - can still buy, just at capped size)
    projected_pct = row.get("projected_position_pct_est", 0.0)
    if projected_pct > max_position_pct:
        warnings.append(
            f"WARN_POSITION_CAPPED_{projected_pct*100:.0f}pct_target_vs_{max_position_pct*100:.0f}pct_max"
        )
    
    return "|".join(warnings) if warnings else ""  # Return all warnings, pipe-separated

def add_risk_columns(df: pd.DataFrame, risk_per_trade_pct: float, max_open_risk_pct: float, max_cluster_pct: float,
                     skip_fx_lookup: bool = False) -> pd.DataFrame:
    """
    Adds risk sizing columns. 
    FIXED V5.9: Robust currency-aware FX conversion with safety blocking.
    """
    if df.empty:
        return df

    df = df.copy()

    # --- FX FIX V5.9: Currency-aware FX conversion ---

    try:
        import yfinance as yf
    except Exception:
        yf = None

    # Cache for FX rates and currency lookups (per-run, not per-row)
    _fx_rate_cache: dict[str, tuple[float | None, str]] = {}  # {pair: (rate, reason)}
    _currency_cache: dict[str, str | None] = {}  # {ticker: currency}

    def _fetch_fx_rate(pair: str) -> float | None:
        """Fetch FX rate from yfinance with caching. Returns None if unavailable."""
        if pair in _fx_rate_cache:
            return _fx_rate_cache[pair][0]
        
        if yf is None:
            _fx_rate_cache[pair] = (None, "NO_YFINANCE")
            return None
        
        try:
            fx_data = yf.download(pair, period="5d", progress=False)
            if not fx_data.empty:
                close_val = fx_data["Close"].iloc[-1]
                rate = float(close_val.iloc[0]) if hasattr(close_val, 'iloc') else float(close_val)
                if rate > 0:
                    _fx_rate_cache[pair] = (rate, f"FX:{pair}")
                    return rate
        except Exception:
            pass
        
        _fx_rate_cache[pair] = (None, f"FX_FAILED:{pair}")
        return None

    def _get_ticker_currency(ticker_yf: str) -> str | None:
        """Get currency from yfinance with caching."""
        t = str(ticker_yf).strip()
        if t in _currency_cache:
            return _currency_cache[t]

        if skip_fx_lookup:
            _currency_cache[t] = None
            return None
        
        if yf is None:
            _currency_cache[t] = None
            return None
        
        ccy = None
        try:
            tk = yf.Ticker(t)
            # Try fast_info first (faster)
            try:
                fi = getattr(tk, "fast_info", None)
                if fi is not None and hasattr(fi, "currency"):
                    ccy = str(fi.currency or "").strip() or None
            except Exception:
                pass
            # Fallback to info dict
            if not ccy:
                try:
                    ccy = str(tk.info.get("currency", "")).strip() or None
                except Exception:
                    pass
        except Exception:
            pass
        
        _currency_cache[t] = ccy
        return ccy

    def get_currency_and_fx_to_gbp(ticker_yf: str, is_held: bool, t212_fx_est: float | None, close_hint: float) -> tuple[str | None, float | None, str, str | None]:
        """
        Robust FX resolver.
        Returns: (currency, fx_to_gbp, fx_reason, fx_pair)
        
        Priority:
        1. Held positions: use T212 snapshot-derived FX
        2. .L tickers: detect GBX/GBP and handle pence conversion
        3. Other tickers: detect currency and fetch appropriate FX rate
        4. If FX unknown: return None (will block entry)
        """
        t = str(ticker_yf).strip().upper()
        
        # A) Held positions: use T212 snapshot-derived FX (most accurate)
        if is_held and t212_fx_est is not None and np.isfinite(t212_fx_est) and t212_fx_est > 0:
            # Detect currency for reporting even if using T212 FX
            ccy = _get_ticker_currency(ticker_yf)
            return (ccy, t212_fx_est, "T212_SNAPSHOT", None)
        
        # B) Detect currency
        ccy = _get_ticker_currency(ticker_yf)
        ccy_u = (ccy or "").upper()
        
        # C) Handle .L tickers specially (GBX/GBP pence handling)
        if t.endswith(".L"):
            unit_factor = 1.0  # 1.0 = pounds, 0.01 = pence
            
            # Check for pence (GBp, GBX)
            if ccy == "GBp" or ccy_u in ("GBX", "GBPENCE", "GB PENCE"):
                unit_factor = 0.01
                return (ccy, unit_factor, "GBX_PENCE", None)
            
            # Heuristic for pence if currency lookup failed
            if ccy_u not in ("USD", "EUR", "CHF") and np.isfinite(close_hint):
                frac = abs(close_hint - round(close_hint))
                if close_hint >= 300 and frac < 0.01:
                    unit_factor = 0.01
                    return (ccy or "GBX", unit_factor, "HEURISTIC_PENCE", None)
            
            # GBP native
            if ccy_u in ("GBP", "GBX", "") or ccy == "GBp":
                return (ccy or "GBP", unit_factor, "GBP_NATIVE", None)
            
            # USD-denominated .L ticker
            if ccy_u == "USD":
                usd_rate = _fetch_fx_rate("GBPUSD=X")
                if usd_rate and usd_rate > 0:
                    fx = unit_factor * (1.0 / usd_rate)
                    return (ccy, fx, "FX:USDGBP", "GBPUSD=X")
        
        # D) GBP native (no conversion needed)
        if ccy_u == "GBP":
            return ("GBP", 1.0, "GBP_NATIVE", None)
        
        # E) Unknown currency - BLOCK
        if not ccy:
            return (None, None, "FX_UNKNOWN_BLOCK", None)
        
        # F) Known foreign currency - fetch FX to GBP
        # Try direct pair first: e.g., CHFGBP=X, EURGBP=X, USDGBP=X
        # Note: yfinance uses format like "GBPUSD=X" meaning "1 GBP = X USD"
        # So for CHF->GBP, we want GBPCHF=X (1 GBP = X CHF), then 1/rate
        
        # Common currencies
        fx_pairs_to_try = [
            (f"GBP{ccy_u}=X", True),   # Inverse: 1 GBP = X CCY, need 1/rate
            (f"{ccy_u}GBP=X", False),  # Direct: 1 CCY = X GBP
        ]
        
        for pair, is_inverse in fx_pairs_to_try:
            rate = _fetch_fx_rate(pair)
            if rate and rate > 0:
                if is_inverse:
                    fx = 1.0 / rate
                    return (ccy, fx, f"FX_INV:{pair}", pair)
                else:
                    return (ccy, rate, f"FX:{pair}", pair)
        
        # G) FX fetch failed - BLOCK
        return (ccy, None, "FX_FETCH_FAILED_BLOCK", None)

    # Pre-fetch common FX rates to warm the cache (reduces repeated calls)
    if not skip_fx_lookup:
        print("[FX] Fetching FX rates...")
        _fetch_fx_rate("GBPUSD=X")  # USD
        _fetch_fx_rate("GBPCHF=X")  # CHF
        _fetch_fx_rate("GBPEUR=X")  # EUR
        print("[FX] FX cache warmed.")

    def resolve_fx(row):
        """Apply FX resolution to each row."""
        ticker_yf = str(row.get("ticker_yf", ""))
        is_held = bool(row.get("is_held", False))
        close_hint = float(row.get("close", np.nan))
        
        # Get T212 estimate for held positions
        t212_fx_est = estimate_fx_to_gbp(row) if is_held else None

        if skip_fx_lookup and not is_held:
            t = ticker_yf.strip().upper()
            if t.endswith(".L"):
                if np.isfinite(close_hint) and close_hint >= 300 and abs(close_hint - round(close_hint)) < 0.01:
                    return pd.Series({"currency": "GBX", "fx_to_gbp_est": 0.01, "fx_reason": "HEURISTIC_PENCE", "fx_pair": None})
                return pd.Series({"currency": "GBP", "fx_to_gbp_est": 1.0, "fx_reason": "GBP_NATIVE", "fx_pair": None})
            return pd.Series({"currency": None, "fx_to_gbp_est": None, "fx_reason": "FX_LOOKUP_SKIPPED_BLOCK", "fx_pair": None})
        
        currency, fx, fx_reason, fx_pair = get_currency_and_fx_to_gbp(
            ticker_yf, is_held, t212_fx_est, close_hint
        )
        
        return pd.Series({
            "currency": currency,
            "fx_to_gbp_est": fx,
            "fx_reason": fx_reason,
            "fx_pair": fx_pair
        })

    fx_result = df.apply(resolve_fx, axis=1)
    df["currency"] = fx_result["currency"]
    df["fx_to_gbp_est"] = fx_result["fx_to_gbp_est"]
    df["fx_reason"] = fx_result["fx_reason"]
    df["fx_pair"] = fx_result["fx_pair"]

    # --- SAFETY GATE: Block entries with unknown FX ---
    fx_block_mask = (
        df["fx_to_gbp_est"].isna() | 
        (df["fx_to_gbp_est"] <= 0) |
        df["fx_reason"].str.contains("BLOCK", case=False, na=False)
    )
    
    # Mark as data anomaly block for candidates with FX issues
    if "data_anomaly_block" not in df.columns:
        df["data_anomaly_block"] = False
    if "data_anomaly_note" not in df.columns:
        df["data_anomaly_note"] = ""
    
    # Only block non-held (candidates) - held positions already have T212 FX
    fx_block_candidates = fx_block_mask & (~df["is_held"].astype(bool))
    df.loc[fx_block_candidates, "data_anomaly_block"] = True
    df.loc[fx_block_candidates, "data_anomaly_note"] = (df.loc[fx_block_candidates, "data_anomaly_note"].fillna("").astype(str).str.strip("|") + "|FX_UNRESOLVED").str.strip("|")
    
    # Log FX blocks
    fx_blocked = df[fx_block_candidates]
    if not fx_blocked.empty:
        print(f"[FX] Blocked {len(fx_blocked)} candidates due to unresolved FX:")
        for _, r in fx_blocked.head(5).iterrows():
            print(f"     - {r['ticker_yf']}: {r['fx_reason']}")

    # --- FX FIX V5.9 END ---

    # =============================================================
    # GBp/GBP CURRENCY VALIDATION (Item 3.7)
    # =============================================================
    # Check for potential 100x position sizing errors:
    # - .L tickers with close > 100 but fx_to_gbp ~ 1.0 (should be 0.01 for pence)
    # - .L tickers with close < 10 but fx_to_gbp ~ 0.01 (should be 1.0 for pounds)
    #
    gbp_issues = []
    
    # Case 1: .L ticker with high close but fx=1.0 (probably pence priced as pounds)
    susp_pence = df[
        df["ticker_yf"].astype(str).str.upper().str.endswith(".L") & 
        (df["close"] > 100) & 
        (df["fx_to_gbp_est"] >= 0.99)
    ]
    if not susp_pence.empty:
        gbp_issues.extend(susp_pence["ticker_yf"].tolist())
        print(f"[WARN] GBp/GBP Issue (pence priced as pounds?): {susp_pence['ticker_yf'].head(10).tolist()}")
        # Flag as data warning but don't block
        df.loc[susp_pence.index, "data_anomaly_note"] = (df.loc[susp_pence.index, "data_anomaly_note"].fillna("").astype(str).str.strip("|") + "|GBP_FX_SUSPECT_PENCE").str.strip("|")
    
    # Case 2: .L ticker with low close but fx=0.01 (probably pounds priced as pence)
    susp_pounds = df[
        df["ticker_yf"].astype(str).str.upper().str.endswith(".L") & 
        (df["close"] < 10) & 
        (df["fx_to_gbp_est"] <= 0.015) &
        (df["fx_to_gbp_est"] > 0)
    ]
    if not susp_pounds.empty:
        gbp_issues.extend(susp_pounds["ticker_yf"].tolist())
        print(f"[WARN] GBp/GBP Issue (pounds priced as pence?): {susp_pounds['ticker_yf'].head(10).tolist()}")
        df.loc[susp_pounds.index, "data_anomaly_note"] = (df.loc[susp_pounds.index, "data_anomaly_note"].fillna("").astype(str).str.strip("|") + "|GBP_FX_SUSPECT_POUNDS").str.strip("|")
    
    if gbp_issues:
        print(f"[FX_VALIDATION] Found {len(gbp_issues)} tickers with potential GBp/GBP issues - check position sizing!")
    else:
        print("[FX_VALIDATION] OK - No GBp/GBP currency issues detected")

    # Risk per share uses the *planned* entry (breakout) and stop level
    df["risk_per_share_local"] = df["breakout_level"] - df["stop_level"]
    df.loc[~np.isfinite(df["risk_per_share_local"]), "risk_per_share_local"] = np.nan
    df.loc[df["risk_per_share_local"] <= 0, "risk_per_share_local"] = np.nan

    # Apply gap risk buffer: single-name stocks gap through stops; inflate risk
    # Stocks: 15% buffer (gap risk), ETFs/HEDGE: 5% (lower volatility)
    # NOTE: Gap buffer ONLY for position sizing, NOT for Gate 2 open risk
    gap_buffer = np.where(
        df["sleeve"].isin(["ETF_CORE", "HEDGE"]),
        1.05,  # ETF/HEDGE: 5% buffer
        1.15   # Stock: 15% buffer
    )
    df["risk_per_share_local"] = df["risk_per_share_local"] * gap_buffer

    df["risk_per_share_gbp_est"] = df["risk_per_share_local"] * df["fx_to_gbp_est"]

    # =========================================================================
    # TIER 1 FIX: Held risk uses ACTIVE STOP (true risk-to-stop)
    # =========================================================================
    # Use active_stop if available, else fall back to stop_level
    # This is the TRUE open risk for Gate 2 calculations
    # NO gap buffer applied to held risk (that's for sizing, not risk reporting)
    df["held_stop_used"] = np.where(
        df["active_stop"].notna() & np.isfinite(df["active_stop"]),
        df["active_stop"],
        df["stop_level"]
    )
    
    # Held stop distance: close - stop_used (clamped at 0)
    df["held_stop_dist_local"] = df["close"] - df["held_stop_used"]
    df.loc[df["held_stop_dist_local"] < 0, "held_stop_dist_local"] = 0.0
    
    # Held risk in GBP: qty * distance * fx (NO gap buffer for true risk calculation)
    df["held_risk_gbp"] = df["t212_quantity"] * df["held_stop_dist_local"] * df["fx_to_gbp_est"]
    df.loc[~df["is_held"].astype(bool), "held_risk_gbp"] = 0.0
    
    # LEGACY: Keep held_risk_gbp_est for backward compatibility (with gap buffer)
    df["held_risk_gbp_est"] = df["t212_quantity"] * df["held_stop_dist_local"] * gap_buffer * df["fx_to_gbp_est"]
    df.loc[~df["is_held"].astype(bool), "held_risk_gbp_est"] = 0.0

    # Portfolio-level totals (use the snapshot equity if present)
    equity = df["t212_total_equity_gbp"].dropna()
    total_equity_gbp = float(equity.iloc[0]) if len(equity) else np.nan

    # =========================================================================
    # TIER 1 FIX: Use TRUE held_risk_gbp (no gap buffer) for Gate 2
    # =========================================================================
    # Total open risk (all sleeves, for reporting) - uses true risk
    open_risk_gbp_total = float(df["held_risk_gbp"].sum(skipna=True)) if len(df) else 0.0
    df["open_risk_gbp_total"] = open_risk_gbp_total
    df["open_risk_pct_total"] = (open_risk_gbp_total / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan

    # Open risk EXCLUDING HEDGE (for Gate 2 blocking decision)
    # HEDGE positions are excluded from Gate 2 open risk calculation
    df_ex_hedge = df[df["sleeve"] != "HEDGE"]
    open_risk_gbp_ex_hedge = float(df_ex_hedge["held_risk_gbp"].sum(skipna=True)) if len(df_ex_hedge) else 0.0
    df["open_risk_gbp_ex_hedge"] = open_risk_gbp_ex_hedge
    df["open_risk_pct_ex_hedge"] = (open_risk_gbp_ex_hedge / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan
    
    # HEDGE risk (for reporting only)
    df_hedge = df[df["sleeve"] == "HEDGE"]
    hedge_risk_gbp = float(df_hedge["held_risk_gbp"].sum(skipna=True)) if len(df_hedge) else 0.0
    df["hedge_risk_gbp"] = hedge_risk_gbp
    df["hedge_risk_pct"] = (hedge_risk_gbp / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan

    # Cluster risk (by held risk) - TIER 1: Use held_risk_gbp (true risk, no gap buffer)
    df["cluster_risk_gbp"] = df.groupby("cluster")["held_risk_gbp"].transform("sum")
    df["cluster_risk_pct"] = (df["cluster_risk_gbp"] / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan

    # Super-cluster risk (by held risk) - thematic concentration control
    if "super_cluster" in df.columns:
        df["super_cluster_risk_gbp"] = df.groupby("super_cluster")["held_risk_gbp"].transform("sum")
        df["super_cluster_risk_pct"] = (df["super_cluster_risk_gbp"] / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan
    else:
        df["super_cluster_risk_gbp"] = 0.0
        df["super_cluster_risk_pct"] = 0.0

    # Sleeve risk (by held risk) for exposure cap - TIER 1: Use held_risk_gbp (true risk)
    df["sleeve_risk_gbp"] = df.groupby("sleeve")["held_risk_gbp"].transform("sum")
    df["sleeve_risk_pct"] = (df["sleeve_risk_gbp"] / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan
    
    # Position size: value of holdings as % of equity
    # Prefer t212_position_value (accurate GBP from T212 walletImpact) for held positions,
    # fall back to calculated value for candidates
    calculated_value = df["t212_quantity"] * df["close"] * df["fx_to_gbp_est"]
    t212_val = pd.to_numeric(df["t212_position_value"], errors="coerce")
    df["position_value_gbp"] = np.where(
        df["is_held"].astype(bool) & t212_val.notna() & (t212_val > 0),
        t212_val,
        calculated_value
    )
    df["position_pct_of_equity"] = (df["position_value_gbp"] / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan

    # Sleeve VALUE exposure (more realistic concentration control than stop-distance risk)
    df["sleeve_value_gbp"] = df.groupby("sleeve")["position_value_gbp"].transform("sum")
    df["sleeve_value_pct"] = (df["sleeve_value_gbp"] / total_equity_gbp) if (np.isfinite(total_equity_gbp) and total_equity_gbp > 0) else np.nan

    # Remaining risk budget
    df["risk_per_trade_pct_default"] = float(risk_per_trade_pct)
    df["max_open_risk_pct_default"] = float(max_open_risk_pct)
    df["max_cluster_pct_default"] = float(max_cluster_pct)
    df["max_supercluster_pct_default"] = float(MAX_SUPERCLUSTER_RISK_PCT)
    
    # --- MOMENTUM EXPANSION: Conditionally increase max_open_risk ---
    # Conditions: BULLISH regime + strong ADX (universe median > threshold)
    market_regime = df["market_regime"].iloc[0] if "market_regime" in df.columns else "UNKNOWN"
    adx_median = df["adx_14"].median() if "adx_14" in df.columns else 0
    
    # Expansion criteria: Strong trending market with tolerable volatility
    # RELAXED: Changed from fixed count (5) to percentage-based (50% of universe)
    # Rationale: In trending markets, some vol expansion is normal - shouldn't block expansion
    atr_spiking_count = df["atr_spiking"].sum() if "atr_spiking" in df.columns else 0
    universe_size = len(df)
    atr_spike_pct = (atr_spiking_count / universe_size) if universe_size > 0 else 0
    
    expansion_allowed = (
        MAX_OPEN_RISK_EXPANSION_ENABLED and  # Must be enabled
        market_regime == "BULLISH" and
        adx_median >= ADX_EXPANSION_THRESHOLD and
        atr_spike_pct < 0.50  # Less than 50% of universe spiking (was: count < 5)
    )
    
    effective_max_risk = MAX_OPEN_RISK_EXPANSION if expansion_allowed else max_open_risk_pct
    df["effective_max_open_risk_pct"] = effective_max_risk
    df["momentum_expansion_active"] = expansion_allowed

    df["risk_budget_remaining_pct"] = (effective_max_risk - df["open_risk_pct_ex_hedge"]) if np.isfinite(df["open_risk_pct_ex_hedge"]).any() else np.nan

    # --- DYNAMIC POSITION/SLEEVE CAPS (scales with portfolio size) ---
    # Count current positions (ex-HEDGE) to determine cap scaling
    position_count = int(df[df["is_held"].astype(bool) & (df["sleeve"] != "HEDGE")].shape[0])
    
    # Scale caps based on position count - TUNED to avoid "cap inversion"
    # Key insight: Position caps must be LESS than cluster/super-cluster caps
    # Otherwise you can't hold any high-conviction positions!
    #
    # NEW PHILOSOPHY: Momentum trading is a numbers game - need 5-8 "bullets"
    # Laggard Purge will automatically "fire" losers, so we can "hire" more candidates
    if position_count < 5:
        # Building stage (0-4 positions): balanced for growth
        # Position caps BELOW cluster cap (35%) to avoid inversion
        MAX_POSITION_PCT_CORE = 0.18      # 18% per position (was 40% - way too high!)
        MAX_POSITION_PCT_ETF = 0.20       # 20% per ETF position
        MAX_POSITION_PCT_HIGH_RISK = 0.12 # 12% per high-risk position
        MAX_SLEEVE_CORE = 0.80            # 80% in STOCK_CORE
        MAX_SLEEVE_HIGH_RISK = 0.40       # 40% in STOCK_HIGH_RISK
        MAX_SLEEVE_ETF = 0.80             # 80% in ETF_CORE
        cap_mode = "BUILDING"
    elif position_count < 8:
        # Mid-stage (5-7 positions): optimal diversification
        MAX_POSITION_PCT_CORE = 0.15      # 15% per position
        MAX_POSITION_PCT_ETF = 0.18       # 18% per ETF position
        MAX_POSITION_PCT_HIGH_RISK = 0.10 # 10% per high-risk position
        MAX_SLEEVE_CORE = 0.70            # 70% in STOCK_CORE
        MAX_SLEEVE_HIGH_RISK = 0.30       # 30% in STOCK_HIGH_RISK
        MAX_SLEEVE_ETF = 0.60             # 60% in ETF_CORE
        cap_mode = "MID_STAGE"
    else:
        # Mature portfolio (8+ positions): strict concentration limits
        MAX_POSITION_PCT_CORE = 0.12      # 12% per position
        MAX_POSITION_PCT_ETF = 0.15       # 15% per ETF position
        MAX_POSITION_PCT_HIGH_RISK = 0.08 # 8% per high-risk position
        MAX_SLEEVE_CORE = 0.60            # 60% in STOCK_CORE
        MAX_SLEEVE_HIGH_RISK = 0.25       # 25% in STOCK_HIGH_RISK
        MAX_SLEEVE_ETF = 0.50             # 50% in ETF_CORE
        cap_mode = "MATURE"
    
    # Store cap mode for transparency in dashboard
    df["position_cap_mode"] = cap_mode
    df["position_count_for_caps"] = position_count
    print(f"[CAPS] Position count: {position_count} -> Mode: {cap_mode}")
    print(f"       Position caps: Core={MAX_POSITION_PCT_CORE:.0%}, ETF={MAX_POSITION_PCT_ETF:.0%}, HighRisk={MAX_POSITION_PCT_HIGH_RISK:.0%}")
    print(f"       Sleeve caps: Core={MAX_SLEEVE_CORE:.0%}, HighRisk={MAX_SLEEVE_HIGH_RISK:.0%}, ETF={MAX_SLEEVE_ETF:.0%}")
    
    # PROJECTED POSITION SIZING (NEW: for candidates without current holdings)
    def compute_projected_size(row):
        """Calculate projected position size for NEW entry (candidate with t212_quantity=0)."""
        if bool(row.get("is_held", False)):
            return 0.0, 0.0, 0.0
        
        equity = total_equity_gbp
        if not np.isfinite(equity) or equity <= 0:
            return 0.0, 0.0, 0.0
        
        # Risk per share in GBP
        risk_per_share = row.get("risk_per_share_gbp_est", np.nan)
        if not np.isfinite(risk_per_share) or risk_per_share <= 0:
            return 0.0, 0.0, 0.0
        
        # Projected shares = (equity * risk_pct) / risk_per_share
        # FRACTIONAL SHARES: Trading 212 supports fractional shares (0.001 minimum)
        # Floor to 3 decimal places instead of whole shares to unlock USD universe
        risk_pct = row.get("risk_per_trade_pct_default", risk_per_trade_pct)
        projected_shares_raw = (equity * risk_pct) / risk_per_share
        projected_shares = np.floor(projected_shares_raw * 1000) / 1000  # Floor to 0.001
        
        # Projected position value and %
        close = row.get("close", np.nan)
        fx = row.get("fx_to_gbp_est", 1.0)
        if not np.isfinite(close) or close <= 0:
            return float(projected_shares), 0.0, 0.0
        
        projected_value = projected_shares * close * fx
        projected_pct = (projected_value / equity) if equity > 0 else 0.0
        
        return float(projected_shares), projected_value, projected_pct

    projected_data = df.apply(compute_projected_size, axis=1, result_type="expand")
    df["projected_shares_est"] = projected_data[0]
    df["projected_position_value_gbp_est"] = projected_data[1]
    df["projected_position_pct_est"] = projected_data[2]
    
    # Use projected size for blocking (for non-held); actual size for held
    df["max_position_cap_used"] = np.where(
        df["is_held"].astype(bool),
        df["position_pct_of_equity"],
        df["projected_position_pct_est"]
    )
    
    # UNIFIED RISK LOGIC: Compute hard blocks and warnings
    def eligible(row):
        """Check hard blocks only. Returns True if no hard blocks present."""
        if str(row.get("status", "")).upper() != "READY":
            return False
        # risk_caps_block_reason is the single source of truth:
        # - For held positions: returns "" if pyramiding+add_eligible, else "ALREADY_HELD"
        # - For candidates: returns "" if no cap breached, else specific block reason
        raw = row.get("risk_caps_block_reason", "")
        if raw is None or (isinstance(raw, float) and np.isnan(raw)) or pd.isna(raw):
            block_reason = ""
        else:
            block_reason = str(raw)
        return block_reason == ""
    
    # Add position count to rows so compute_risk_caps_block_reason can use it
    df["position_count_ex_hedge"] = position_count
    # Note: effective_max_positions from breadth isn't computed yet at this stage,
    # so use MAX_POSITIONS as the default. It will be re-evaluated after breadth runs.
    if "effective_max_positions" not in df.columns:
        df["effective_max_positions"] = MAX_POSITIONS
    
    # Compute block and warning reasons using unified functions
    df["risk_caps_block_reason"] = df.apply(
        lambda r: compute_risk_caps_block_reason(
            r, total_equity_gbp, effective_max_risk, max_cluster_pct,
            (
                MAX_POSITION_PCT_ETF if r.get("sleeve") == "ETF_CORE" else
                MAX_POSITION_PCT_HIGH_RISK if r.get("sleeve") == "STOCK_HIGH_RISK" else
                MAX_POSITION_PCT_CORE
            ),
            MAX_SUPERCLUSTER_RISK_PCT
        ),
        axis=1
    )
    
    df["risk_warning_reason"] = df.apply(
        lambda r: compute_risk_warning_reason(
            r,
            total_equity_gbp,
            effective_max_risk,
            max_sleeve_pct=(
                MAX_SLEEVE_ETF if r.get("sleeve") == "ETF_CORE" else
                MAX_SLEEVE_HIGH_RISK if r.get("sleeve") == "STOCK_HIGH_RISK" else
                MAX_SLEEVE_CORE
            ),
            max_position_pct=(
                MAX_POSITION_PCT_ETF if r.get("sleeve") == "ETF_CORE" else
                MAX_POSITION_PCT_HIGH_RISK if r.get("sleeve") == "STOCK_HIGH_RISK" else
                MAX_POSITION_PCT_CORE
            ),
        ),
        axis=1
    )
    
    # Set eligible based on hard blocks only
    df["eligible_by_risk_caps"] = df.apply(eligible, axis=1)
    
    # R:R soft quality gate: Warn (don't block) if R:R is unfavorable (>0.67 = less than 1:1.5)
    # This doesn't prevent entry but surfaces the info for the action card
    
    def calc_risk_reward(row):
        if bool(row.get("is_held", False)):
            return np.nan  # Not applicable for held positions
        status = str(row.get("status", "")).upper()
        if status not in ["READY", "WATCH"]:
            return np.nan
        
        entry_trigger = row.get("entry_trigger", np.nan)
        stop = row.get("stop_level", np.nan)
        atr = row.get("atr_14", np.nan)
        close = row.get("close", np.nan)
        
        # Fallback to breakout_level if entry_trigger not available
        if not np.isfinite(entry_trigger):
            entry_trigger = row.get("breakout_level", np.nan)
        
        if not (np.isfinite(entry_trigger) and np.isfinite(stop) and np.isfinite(atr) and np.isfinite(close)):
            return np.nan
        
        risk = entry_trigger - stop
        
        # Target: ATR-based projected move scaled by trend efficiency
        # - Base expectation: 2*ATR from entry (turtle-standard)
        # - Efficiency bonus: clean trends (high efficiency) get higher targets
        # - Stop tightness bonus: tighter stops (lower risk/entry%) get better R:R
        #
        # trend_efficiency: % of ATR that translates to directional movement (0-100)
        # Higher efficiency = more ATR becomes profit, less noise
        efficiency = row.get("trend_efficiency", np.nan)
        if not np.isfinite(efficiency):
            efficiency = 50.0  # Default middle value
        
        # Scale target from 2*ATR (poor trend) to 4*ATR (excellent trend)
        # trend_efficiency ranges 0.0-1.0 (0-100%)
        # efficiency 0-0.30: ~2.0x, 0.50: ~3.0x, 0.80+: ~4.0x
        eff_pct = min(max(efficiency * 100.0, 0), 100)  # Convert 0-1 to 0-100
        target_mult = 2.0 + (eff_pct / 50.0)  # 2.0 to 4.0
        target = entry_trigger + (target_mult * atr)
        reward = target - entry_trigger
        
        if risk <= 0 or reward <= 0:
            return np.nan
        
        return risk / reward  # Lower is better (means reward > risk)
    
    df["risk_reward_ratio"] = df.apply(calc_risk_reward, axis=1)

    # Human-friendly R:R display (reward:risk). Example: risk/reward=0.50 => rr_display="1:2.00"
    df["rr_display"] = df["risk_reward_ratio"].apply(
        lambda x: f"1:{(1.0/x):.2f}" if pd.notna(x) and np.isfinite(x) and x > 0 else ""
    )

    # Return df plus cap info for transparency
    cap_info = {
        "position_count": position_count,
        "cap_mode": cap_mode,
        "MAX_POSITION_PCT_CORE": MAX_POSITION_PCT_CORE,
        "MAX_POSITION_PCT_ETF": MAX_POSITION_PCT_ETF,
        "MAX_POSITION_PCT_HIGH_RISK": MAX_POSITION_PCT_HIGH_RISK,
        "MAX_SLEEVE_CORE": MAX_SLEEVE_CORE,
        "MAX_SLEEVE_HIGH_RISK": MAX_SLEEVE_HIGH_RISK,
        "MAX_SLEEVE_ETF": MAX_SLEEVE_ETF,
        "effective_max_risk": effective_max_risk,
        "expansion_allowed": expansion_allowed,
    }
    return df, cap_info



def add_rank_score(df: pd.DataFrame) -> pd.DataFrame:
    """
    Adds numeric `rank_score` + transparency columns for debugging.

    Columns added:
      - rank_score: deterministic ranking (lower = better)
      - rankable: True if rank_score was computed, False if blocked
      - rank_block_reason: explains why rank_score is NaN (if not rankable)

    Lower is better. Encodes the hierarchy (stock-first):
      1) STOCK_CORE TREND (use distance_to_20d_high_pct)
      2) STOCK_CORE RANGE (use range_position_20)
      3) ETF_CORE (use distance_to_55d_high_pct)
      4) STOCK_HIGH_RISK (TREND then RANGE)
    Tie-break nudges (small weights):
      - Higher ADX better
      - Higher vol_ratio better
      - Lower extension_atr better
    """
    if df.empty:
        return df

    df = df.copy()
    df["rank_score"] = np.nan
    df["rankable"] = False
    df["rank_block_reason"] = ""

    # Only rank prospective entries (not held). We still rank WATCH/READY so you can sort either set.
    m = (~df["is_held"].astype(bool)) & (df["status"].isin(["READY", "WATCH"]))

    # Assign block reasons for non-rankable rows
    held_m = df["is_held"].astype(bool)
    df.loc[held_m, "rank_block_reason"] = "held_position"
    
    not_status_m = ~df["status"].isin(["READY", "WATCH"])
    df.loc[not_status_m & ~held_m, "rank_block_reason"] = "status_not_ready_or_watch"

    # base category (big gaps so category always dominates)
    base = np.full(len(df), np.nan, dtype=float)

    is_etf = (df["sleeve"] == "ETF_CORE")
    is_core_tr = (df["sleeve"] == "STOCK_CORE") & (df["regime"] == "TREND")
    is_core_rg = (df["sleeve"] == "STOCK_CORE") & (df["regime"] == "RANGE")
    is_hi_tr = (df["sleeve"] == "STOCK_HIGH_RISK") & (df["regime"] == "TREND")
    is_hi_rg = (df["sleeve"] == "STOCK_HIGH_RISK") & (df["regime"] == "RANGE")

    # Stock-first ordering:
    #   STOCK_CORE (TREND then RANGE) -> ETF_CORE -> STOCK_HIGH_RISK
    base[is_core_tr.values] = 0
    base[is_core_rg.values] = 1
    base[is_etf.values] = 2
    base[is_hi_tr.values] = 3
    base[is_hi_rg.values] = 4
    base = pd.Series(base, index=df.index)

    # Guardrail 3: Expose rank bucket as debug column (0=CORE_TR, 1=CORE_RG, 2=ETF, 3=HI_TR, 4=HI_RG)
    df["rank_bucket"] = base

    # primary metric by category (smaller is better)
    primary = pd.Series(np.nan, index=df.index, dtype=float)
    primary.loc[is_etf] = df.loc[is_etf, "distance_to_55d_high_pct"]
    primary.loc[is_core_tr | is_hi_tr] = df.loc[is_core_tr | is_hi_tr, "distance_to_20d_high_pct"]
    # range_position_20 is 0..1 so scale up to be comparable to pct metrics
    primary.loc[is_core_rg | is_hi_rg] = df.loc[is_core_rg | is_hi_rg, "range_position_20"] * 100.0

    # Tie-break components (tiny weights)
    adx = df.get("adx_14", pd.Series(np.nan, index=df.index))
    volr = df.get("vol_ratio", pd.Series(np.nan, index=df.index))
    ext = df.get("extension_atr", pd.Series(np.nan, index=df.index))
    
    # MODULE 4: Trend Efficiency boost/penalty
    trend_eff = df.get("trend_efficiency", pd.Series(np.nan, index=df.index))
    
    # MODULE 6: Relative Strength boost
    rs_score = df.get("rs_vs_benchmark", pd.Series(np.nan, index=df.index))

    tie = pd.Series(0.0, index=df.index)
    tie += np.where(np.isfinite(adx), (-adx / 100.0), 0.0)               # higher ADX => slightly lower score
    tie += np.where(np.isfinite(volr), (-np.clip(volr, 0, 5) / 100.0), 0.0)  # higher vol_ratio => slightly lower score
    tie += np.where(np.isfinite(ext), (np.clip(ext, -5, 5) / 1000.0), 0.0)   # lower extension better
    
    # Trend Efficiency: boost smooth trends, penalize choppy ones
    if TREND_EFFICIENCY_ENABLED:
        # High efficiency (>0.6) gets bonus (lower score = better)
        tie += np.where(
            np.isfinite(trend_eff) & (trend_eff >= TREND_EFFICIENCY_BOOST_THRESHOLD),
            -0.5,  # Significant boost for smooth trends
            0.0
        )
        # Low efficiency (<0.3) gets penalty (higher score = worse)
        tie += np.where(
            np.isfinite(trend_eff) & (trend_eff < TREND_EFFICIENCY_PENALTY_THRESHOLD),
            0.3,   # Penalty for choppy stocks
            0.0
        )
    
    # Relative Strength: boost outperformers meaningfully but not overwhelmingly
    # The primary score (distance_to_20d_high_pct * 1000) typically ranges 0-3,000
    # RS should be a significant tiebreaker but not override proximity to breakout
    # RS boost capped at 50 points (meaningful vs primary's 0-3000 range)
    if RS_RANKING_ENABLED:
        # Positive RS gets proportional boost
        # rs_vs_benchmark is typically 0.05-0.40 (5%-40% outperformance)
        # Multiply by 200, cap at 50 points — enough to reorder within same distance band
        tie += np.where(
            np.isfinite(rs_score) & (rs_score > 0),
            -np.clip(rs_score * 200, 0, 50),  # Up to -50 boost (was -500, too dominant)
            0.0
        )
        # Negative RS (underperformers) get penalty
        tie += np.where(
            np.isfinite(rs_score) & (rs_score < 0),
            -rs_score * 50,  # Penalty for underperformers (positive score = worse)
            0.0
        )

    # Compute score only where we have a base + primary
    ok = m & np.isfinite(base) & np.isfinite(primary)
    df.loc[ok, "rank_score"] = (base.loc[ok] * 1_000_000.0) + (primary.loc[ok] * 1_000.0) + tie.loc[ok]
    df.loc[ok, "rankable"] = True
    
    # Set block reasons for rows where ranking failed
    failed_to_rank = m & ~ok
    df.loc[failed_to_rank & ~np.isfinite(base), "rank_block_reason"] = "missing_base_metric"
    df.loc[failed_to_rank & ~np.isfinite(primary), "rank_block_reason"] = "missing_primary_metric"
    df.loc[failed_to_rank & (df["rank_block_reason"] == ""), "rank_block_reason"] = "unknown_block"

    return df

# ----------------------------
# Main
# ----------------------------

def main():
    print(f"RUNNING {VERSION}")

    ap = argparse.ArgumentParser()
    ap.add_argument("--etfs", required=True)
    ap.add_argument("--stocks_core", required=True)
    ap.add_argument("--stocks_risk", required=True)
    ap.add_argument("--hedge", default="universes/hedge.txt")  # HEDGE sleeve (excluded from Gate 2)
    ap.add_argument("--ticker_map", default="universes/ticker_map.csv")
    ap.add_argument("--holdings", default="universes/holdings.txt")
    ap.add_argument("--t212_snapshot", default="outputs/t212_snapshot.json")  # optional portfolio snapshot
    ap.add_argument("--positions_state", default="universes/positions_state.csv")  # stateful stops + profit protection
    ap.add_argument("--exclude_sells", default="universes/exclude_sells.txt")  # optional: exclude from Mandatory Sells
    ap.add_argument("--cluster_map", default="universes/cluster_map.csv")  # optional: ticker_yf->cluster
    ap.add_argument("--super_cluster_map", default="universes/super_cluster_map.csv")  # optional: ticker_yf->super_cluster
    ap.add_argument("--benchmark", default="VWRL.L")  # choose your benchmark YF ticker

    ap.add_argument("--benchmark2", default="SPY")  # second benchmark for dual regime (default SPY for US exposure)
    ap.add_argument("--regime_band_pct", type=float, default=0.02)  # CHOP band around MA200 (e.g., 0.02 = 2%)
    # CRITICAL: These defaults come from ACTIVE_CONFIG (single source of truth)
    ap.add_argument("--risk_per_trade_pct", type=float, default=ACTIVE_CONFIG.get("risk_per_trade", 0.0075))
    ap.add_argument("--max_positions", type=int, default=ACTIVE_CONFIG.get("max_positions", 8))
    ap.add_argument("--max_open_risk_pct", type=float, default=ACTIVE_CONFIG.get("max_open_risk", 0.07))
    # TUNED: Raised from 30% to 35% to allow 2-3 stocks per sector (e.g., Semiconductors)
    ap.add_argument("--max_cluster_pct", type=float, default=0.35)
    # Small account mode from active_config (can be overridden by --small_account_mode flag)
    ap.add_argument("--small_account_mode", action="store_true", 
                    default=ACTIVE_CONFIG.get("small_account_mode", False),
                    help="Enable relaxed limits for small accounts (<£2k): disable ATR cap, loosen cluster/supercluster limits")
    ap.add_argument("--run_meta", default="outputs/run_meta.json")
    ap.add_argument("--skip_fx_lookup", action="store_true",
                    help="Skip external FX lookups (use T212 snapshot or .L heuristics only)")
    ap.add_argument("--max_data_age_days", type=int, default=5)
    ap.add_argument("--out", default="outputs/master_snapshot.csv")
    ap.add_argument("--action_card", default="outputs/weekly_action_card.md")
    args = ap.parse_args()

    # --- Load optional exclude list for Mandatory Sells ---
    exclude_sells = read_list(Path(args.exclude_sells))

    # --- Override global MAX_POSITIONS from CLI ---
    global MAX_POSITIONS, ATR_PCT_CAP_ENABLED, HEAT_CHECK_CLUSTER_THRESHOLD, MAX_SUPERCLUSTER_RISK_PCT
    MAX_POSITIONS = args.max_positions
    print(f"[CONFIG] MAX_POSITIONS = {MAX_POSITIONS}, RISK_PER_TRADE = {args.risk_per_trade_pct:.2%}")

    # --- SMALL ACCOUNT MODE ---
    # Relaxes certain limits for concentrated, high-growth small accounts (<£2k)
    # While keeping crash protection modules enabled
    if args.small_account_mode:
        print("\n" + "="*60)
        print("  SMALL ACCOUNT MODE ENABLED")
        print("="*60)
        print("  Adjusting limits for concentrated growth:")
        
        # Disable ATR volatility cap (allow more volatile entries)
        ATR_PCT_CAP_ENABLED = False
        print("    - ATR_PCT_CAP_ENABLED = False (allow volatile entries)")
        
        # Loosen cluster heat check (allow more positions per sector)
        HEAT_CHECK_CLUSTER_THRESHOLD = 4  # was 3
        print("    - HEAT_CHECK_CLUSTER_THRESHOLD = 4 (was 3)")
        
        # Raise super-cluster cap (allow more thematic concentration)
        MAX_SUPERCLUSTER_RISK_PCT = 0.60  # was 0.50
        print("    - MAX_SUPERCLUSTER_RISK_PCT = 60% (was 50%)")
        
        print("\n  Protection modules STILL ENABLED:")
        print("    - PROFIT_PROTECTION_ENABLED = True")
        print("    - BREADTH_SAFETY_ENABLED = True") 
        print("    - ADX_DIRECTION_FILTER = True")
        print("    - LAGGARD_PURGE_ENABLED = True")
        print("="*60 + "\n")

    # --- RUN SANITY CHECKS ---
    sanity_warnings = run_sanity_checks(args)
    if sanity_warnings:
        print("\n" + "="*60)
        print("SANITY CHECK WARNINGS")
        print("="*60)
        for warn in sanity_warnings:
            print(warn)
        print("="*60 + "\n")
    else:
        print("[SANITY] All 5 checks passed OK")

    # --- CONFIG COHERENCE CHECK ---
    coherence_errors = []
    if PYRAMIDING_ENABLED and ADD_LIMIT <= 0:
        coherence_errors.append(f"PYRAMIDING_ENABLED=True but ADD_LIMIT={ADD_LIMIT}")
    if not PYRAMIDING_ENABLED and ADD_LIMIT > 0:
        coherence_errors.append(f"PYRAMIDING_ENABLED=False but ADD_LIMIT={ADD_LIMIT}")
    if LAGGARD_MIN_LOSS_PCT < 0:
        coherence_errors.append(f"LAGGARD_MIN_LOSS_PCT={LAGGARD_MIN_LOSS_PCT} is negative (loss_pct is positive when underwater)")
    if PYRAMID_MAX_ADDS != ADD_LIMIT and PYRAMIDING_ENABLED:
        coherence_errors.append(f"PYRAMID_MAX_ADDS={PYRAMID_MAX_ADDS} != ADD_LIMIT={ADD_LIMIT}")

    print("\n" + "="*60)
    print("CONFIG COHERENCE CHECK")
    print("="*60)
    print(f"  ADD_LIMIT             = {ADD_LIMIT}")
    print(f"  PYRAMIDING_ENABLED    = {PYRAMIDING_ENABLED}  (derived from ADD_LIMIT > 0)")
    print(f"  PYRAMID_MAX_ADDS      = {PYRAMID_MAX_ADDS}")
    print(f"  LAGGARD_MIN_LOSS_PCT  = {LAGGARD_MIN_LOSS_PCT}")
    print(f"  LAGGARD_PURGE_ENABLED = {LAGGARD_PURGE_ENABLED}")
    if coherence_errors:
        print("\n  *** COHERENCE ERRORS ***")
        for err in coherence_errors:
            print(f"    FATAL: {err}")
        print("="*60)
        sys.exit(1)
    else:
        print("  All config coherence checks passed OK")
    print("="*60 + "\n")

    etfs = read_list(Path(args.etfs))
    core = read_list(Path(args.stocks_core))
    risk = read_list(Path(args.stocks_risk))
    hedge = read_portfolio_csv(Path(args.hedge))  # HEDGE sleeve - supports CSV or TXT format
    held = set(t.upper() for t in read_list(Path(args.holdings)))
    tmap = read_ticker_map(Path(args.ticker_map))
    pos_state = read_positions_state(Path(args.positions_state))
    cluster_map = read_cluster_map(Path(args.cluster_map))
    super_cluster_map = read_super_cluster_map(Path(args.super_cluster_map))
    t212 = load_t212_snapshot(Path(args.t212_snapshot), tmap)
    t212_pos = t212.get("positions", {})

    # --- Refresh holdings.txt + held set from snapshot (source of truth) ---
    snapshot_held = set()
    for tyf, p in (t212_pos or {}).items():
        try:
            qty = float(p.get("quantity", 0) or 0)
        except Exception:
            qty = 0.0
        if qty > 0 and tyf:
            snapshot_held.add(str(tyf).upper().strip())

    if snapshot_held:
        held = snapshot_held  # IMPORTANT: override in-memory held set

        try:
            holdings_path = Path(args.holdings)
            holdings_path.parent.mkdir(parents=True, exist_ok=True)
            holdings_path.write_text("\n".join(sorted(snapshot_held)) + "\n", encoding="utf-8")
            print(f"Wrote {len(snapshot_held)} holdings to: {holdings_path}")
        except Exception as e:
            print(f"[WARN] Could not write holdings.txt: {e}")

    universe = []
    # HEDGE sleeve first (highest priority - will take precedence if ticker is in multiple lists)
    for t in hedge:
        universe.append({"ticker": t, "ticker_yf": map_ticker(t, tmap), "sleeve": "HEDGE"})
    for t in etfs:
        universe.append({"ticker": t, "ticker_yf": map_ticker(t, tmap), "sleeve": "ETF_CORE"})
    for t in core:
        universe.append({"ticker": t, "ticker_yf": map_ticker(t, tmap), "sleeve": "STOCK_CORE"})
    for t in risk:
        universe.append({"ticker": t, "ticker_yf": map_ticker(t, tmap), "sleeve": "STOCK_HIGH_RISK"})

    dfu = pd.DataFrame(universe)
    # Enforce uniqueness by underlying ticker_yf across sleeves (prevents double-counting)
    dfu, dropped_dupes = enforce_unique_underlyings(dfu)
    yf_tickers = dfu["ticker_yf"].unique().tolist()

    # ensure benchmark included
    bench = args.benchmark
    if bench not in yf_tickers:
        yf_tickers.append(bench)

    # ensure benchmark2 included (if specified)
    bench2 = args.benchmark2 or None
    if bench2 and bench2 not in yf_tickers:
        yf_tickers.append(bench2)

    raw = yf.download(
        yf_tickers,
        period="2y",
        interval="1d",
        group_by="ticker",
        auto_adjust=False,
        threads=True,
        progress=False,
    )

    # ==========================================================================
    # SYSTEM HARDENING: Validate bulk download integrity
    # ==========================================================================
    _valid_tickers, _download_issues = validate_bulk_download(raw, yf_tickers)
    if _download_issues:
        for _issue in _download_issues:
            print(f"[VALIDATION] {_issue}")
        if any("CRITICAL" in i for i in _download_issues):
            print("[VALIDATION] CRITICAL download issues detected — review before trading!")

    market = compute_market_regime(raw, bench, args.max_data_age_days, band_pct=args.regime_band_pct, benchmark2_yf=(args.benchmark2 or None))

    # ==========================================================================
    # MODULE 6: BENCHMARK RETURN FOR RS CALCULATION
    # ==========================================================================
    benchmark_return_3m = np.nan
    if RS_RANKING_ENABLED:
        try:
            bench_df = raw[bench].dropna(how="all").copy()
            if isinstance(bench_df.columns, pd.MultiIndex):
                bench_df.columns = bench_df.columns.get_level_values(0)
            bench_price = bench_df["Adj Close"] if "Adj Close" in bench_df.columns else bench_df["Close"]
            if len(bench_price) >= RS_LOOKBACK_DAYS:
                bench_close = float(bench_price.iloc[-1])
                bench_3m_ago = float(bench_price.iloc[-RS_LOOKBACK_DAYS])
                if np.isfinite(bench_3m_ago) and bench_3m_ago > 0:
                    benchmark_return_3m = (bench_close - bench_3m_ago) / bench_3m_ago
        except Exception:
            benchmark_return_3m = np.nan

    out_rows = []
    skips = []
    validation_results = []  # System Hardening: collect per-ticker validation
    now_utc = pd.Timestamp(datetime.now(timezone.utc)).tz_localize(None)

    for _, u in dfu.iterrows():
        t = u["ticker"]
        tyf = u["ticker_yf"]
        sleeve = u["sleeve"]

        try:
            df = raw[tyf].dropna(how="all").copy()
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            df = df.sort_index()

            if df.empty or len(df) < 230:
                skips.append({"ticker": t, "ticker_yf": tyf, "reason": "INSUFFICIENT_BARS"})
                continue

            last_bar = pd.Timestamp(df.index[-1]).tz_localize(None)
            age_days = (now_utc.normalize() - last_bar.normalize()).days
            if age_days > args.max_data_age_days:
                skips.append({"ticker": t, "ticker_yf": tyf, "reason": f"STALE_DATA age_days={age_days}"})
                continue

            m = compute_metrics(df, sleeve=sleeve)
            p = t212_pos.get(tyf, {})
            t212_qty = float(p.get("quantity", 0) or 0)
            t212_avg = p.get("avg_price", np.nan)
            t212_cur = p.get("current_price", np.nan)
            t212_val = p.get("value_gbp", np.nan)

            # --- HELD SOURCE OF TRUTH ---
            snapshot_has_positions = bool(t212_pos)  # if we have a snapshot positions list, trust it
            is_held_from_snapshot = (t212_qty > 0)

            # holdings.txt fallback (only if snapshot missing)
            is_held_from_list = (
                (t.upper() in held) or
                (tmap.get(t.upper(), "").upper() in held) or
                (tyf.upper() in held)
            )

            # If snapshot exists, it is the truth. Otherwise use holdings.txt
            is_held = is_held_from_snapshot if snapshot_has_positions else is_held_from_list

            # Helpful debug column: flag if holdings.txt says held but snapshot says not held
            held_list_mismatch = bool(snapshot_has_positions and is_held_from_list and not is_held_from_snapshot)

            row = {
        "ticker": t,
        "ticker_yf": tyf,
        "sleeve": sleeve,
        "cluster": assign_cluster(tyf, sleeve, cluster_map),
        # Auto-fill missing super_cluster as "UNCATEGORIZED" so caps still apply
        "super_cluster": super_cluster_map.get(tyf.upper(), super_cluster_map.get(tyf, "")) or "UNCATEGORIZED",

        # Held based on source of truth (snapshot if available, else holdings.txt)
        "is_held": is_held,
        "held_list_mismatch": held_list_mismatch,

        "last_bar_date": str(last_bar.date()),
        "data_age_days": int(age_days),

        # snapshot fields (optional)
        "t212_quantity": t212_qty,
        "t212_avg_price": t212_avg,
        "t212_current_price": t212_cur,
        "t212_position_value": t212_val,
        "t212_currency": p.get("currency", None),
        "t212_total_equity_gbp": t212.get("total_equity_gbp", np.nan),
        "t212_cash_gbp": t212.get("cash_gbp", np.nan),

        **market,
        **m,
    }


            regime, status, reason, breakout, stop, entry_trigger, atr_buffer_mult = classify(row)
            
            # =================================================================
            # TREND EFFICIENCY GATE (30% minimum for READY status)
            # =================================================================
            # Block low-efficiency stocks from becoming READY to avoid whipsaws
            if TREND_EFFICIENCY_GATE_ENABLED and status == "READY":
                trend_eff = row.get("trend_efficiency", np.nan)
                if np.isfinite(trend_eff) and trend_eff < TREND_EFFICIENCY_MIN_FOR_READY:
                    status = "WATCH"
                    reason = f"Efficiency gate: {trend_eff:.0%} < {TREND_EFFICIENCY_MIN_FOR_READY:.0%} min (choppy price action)"
            
            # =================================================================
            # WHIPSAW KILL SWITCH (Block serial stop-hit tickers)
            # =================================================================
            # Check if ticker is blocked due to repeated whipsaws
            today_str = datetime.now().strftime("%Y-%m-%d")
            whipsaw_info = check_whipsaw_blocked(t, pos_state, today_str)
            row["whipsaw_blocked"] = whipsaw_info.get("whipsaw_blocked", False)
            row["whipsaw_count"] = whipsaw_info.get("whipsaw_count", 0)
            if whipsaw_info.get("whipsaw_blocked", False) and status == "READY":
                status = "WATCH"
                reason = whipsaw_info["whipsaw_reason"]
            
            row["regime"] = regime
            row["status"] = status
            row["reason"] = reason
            row["breakout_level"] = breakout
            row["stop_level"] = stop
            row["entry_trigger"] = entry_trigger  # breakout + ATR buffer (kills fake breakouts)
            row["atr_buffer_mult_used"] = atr_buffer_mult  # TIER 2: Track buffer used

            # --- STATEFUL STOPS + PROFIT PROTECTION ---
            stateful = compute_stateful_stop(row, pos_state, market.get("market_regime", "UNKNOWN"))
            row["candidate_stop"] = stateful["candidate_stop"]
            row["active_stop"] = stateful["active_stop"]
            row["stop_reason"] = stateful["stop_reason"]
            row["profit_R"] = stateful["profit_R"]
            row["profit_protection_level"] = stateful["profit_protection_level"]
            row["initial_R"] = stateful["initial_R"]
            
            # Add entry_price from state for display purposes
            state_data = pos_state.get(t.upper(), {})
            row["entry_price"] = state_data.get("entry_price", np.nan)
            
            # For held positions, use active_stop (stateful) instead of candidate stop
            if is_held and np.isfinite(stateful["active_stop"]):
                row["stop_level"] = stateful["active_stop"]
            
            # Collect state updates for persistence
            state_update = stateful.get("_state_update")
            if state_update and is_held:
                pos_state[t.upper()] = {
                    "entry_price": state_update.get("entry_price", np.nan),
                    "initial_stop": state_update.get("initial_stop", np.nan),
                    "active_stop": state_update.get("active_stop", np.nan),
                    "adds_taken": state_update.get("adds_taken", 0),
                    "entry_date": state_update.get("entry_date", ""),
                }
                
                # TIER 3: Log fill sanity for NEW entries
                if stateful.get("_is_new_entry", False):
                    try:
                        log_fill_sanity(
                            ticker=t,
                            expected_trigger=row.get("entry_trigger", np.nan),
                            expected_stop=row.get("stop_level", np.nan),
                            actual_fill_price=row.get("t212_avg_price", np.nan),
                            exec_guard_blocked=not row.get("exec_guard_pass", True),
                            notes=f"sleeve={sleeve}, status={status}"
                        )
                    except Exception as e:
                        print(f"[WARN] Fill sanity log failed for {t}: {e}")

            # extension vs ATR (informational)
            try:
                if np.isfinite(row.get("breakout_level", np.nan)) and np.isfinite(row.get("atr_14", np.nan)) and row["atr_14"] > 0:
                    row["extension_atr"] = (row["close"] - row["breakout_level"]) / row["atr_14"]
                else:
                    row["extension_atr"] = np.nan
            except Exception:
                row["extension_atr"] = np.nan

            # --- TIER 1: EXECUTION GUARD (Gap/Extension Filter) ---
            exec_guard = compute_execution_guard(row)
            row["exec_guard_pass"] = exec_guard["exec_guard_pass"]
            row["exec_guard_reason"] = exec_guard["exec_guard_reason"]
            row["extension_atr_above_trigger"] = exec_guard["extension_atr_above_trigger"]
            row["extension_pct_above_trigger"] = exec_guard["extension_pct_above_trigger"]

            # --- MODULE 2: EARLY BIRD ELIGIBILITY (for display/tracking) ---
            # This is called in classify() for ADX bypass, but we also expose it in output
            early_bird_eligible, early_bird_reason = check_early_bird_eligible(row)
            row["early_bird_eligible"] = early_bird_eligible
            row["early_bird_reason"] = early_bird_reason

            # --- MODULE 3: LAGGARD PURGE CHECK ---
            laggard_info = check_laggard_purge(row, pos_state)
            row["is_laggard"] = laggard_info["is_laggard"]
            row["laggard_reason"] = laggard_info["laggard_reason"]
            row["holding_days"] = laggard_info["holding_days"]
            row["laggard_loss_pct"] = laggard_info["laggard_loss_pct"]

            # --- MODULE 6: RELATIVE STRENGTH vs BENCHMARK ---
            rs_info = compute_relative_strength(row, benchmark_return_3m)
            row["rs_vs_benchmark"] = rs_info["rs_vs_benchmark"]
            row["benchmark_return_3m"] = benchmark_return_3m

            action, action_reason = compute_exit_signal(row)
            
            # --- MODULE 5: CLIMAX TOP EXIT CHECK (TIER 2: tighten/trim instead of sell) ---
            is_climax, climax_reason, climax_info = check_climax_exit(row)
            row["climax_flag"] = climax_info["climax_flag"]
            row["climax_action"] = climax_info["climax_action"]
            row["climax_suggested_stop"] = climax_info["climax_suggested_stop"]
            
            # TIER 2 FIX: Only override action if climax_action is SELL
            if is_climax and action == "HOLD":
                if climax_info["climax_action"] == "SELL":
                    action = "EXIT_CLIMAX"
                    action_reason = climax_reason
                else:
                    # TIGHTEN_STOP or TRIM: keep HOLD but add info to reason
                    action_reason = climax_reason
            
            # Override action for laggards (suggestion, not automatic)
            if laggard_info["is_laggard"] and action == "HOLD":
                action = "TRIM_LAGGARD"
                action_reason = laggard_info["laggard_reason"]
            
            row["held_action"] = action
            row["held_action_reason"] = action_reason
            row["is_climax_exit"] = is_climax

            add_info = compute_add_signals(row, pos_state)
            row.update(add_info)
            
            # Re-entry eligibility check (for stocks not currently held)
            # (today_str already defined earlier for whipsaw check)
            reentry_info = check_reentry_eligible(t, row, pos_state, today_str)
            row.update(reentry_info)
            
            # --- MODULE 9: FAST-FOLLOWER RE-ENTRY CHECK ---
            # Check if recently stopped-out stock has reclaimed highs with volume
            fast_follower = check_fast_follower_reentry(t, row, pos_state, today_str)
            row["fast_follower_eligible"] = fast_follower["fast_follower_eligible"]
            row["fast_follower_reason"] = fast_follower["fast_follower_reason"]
            row["last_exit_reason"] = fast_follower["last_exit_reason"]
            
            # If fast-follower eligible, flag the action status
            if fast_follower["fast_follower_eligible"] and not is_held:
                row["status"] = "READY"  # Override to READY for re-entry
                row["reason"] = fast_follower["fast_follower_reason"]

            # =================================================================
            # SYSTEM HARDENING: Per-ticker validation
            # =================================================================
            _state_data = pos_state.get(t.upper(), {})
            _vr = validate_ticker_full(
                ticker=t,
                ticker_yf=tyf,
                df=df,
                atr_14=row.get("atr_14", np.nan),
                close=row.get("close", np.nan),
                stop_level=row.get("stop_level", np.nan),
                sleeve=sleeve,
                is_held=is_held,
                entry_price=float(_state_data.get("entry_price", np.nan)),
                initial_stop=float(_state_data.get("initial_stop", np.nan)),
                active_stop=float(_state_data.get("active_stop", np.nan)),
                t212_current_price=t212_cur if np.isfinite(t212_cur) else np.nan,
            )
            validation_results.append(_vr)

            # Record validation status in the row
            row["validation_ok"] = _vr.ok
            row["validation_warnings"] = len(_vr.warnings)
            row["validation_errors"] = len(_vr.errors)
            row["validation_notes"] = _vr.summary() if not _vr.clean else ""

            # If validation found errors on a HELD position, flag it loudly
            if not _vr.ok and is_held:
                print(f"[VALIDATION ALERT] HELD position {t}: {_vr.summary()}")

            # Strict BULLISH-only signals for new entries
            market_regime_val = str(row.get("market_regime", "UNKNOWN")).upper()
            if (not is_held) and (market_regime_val != "BULLISH"):
                row["status"] = "IGNORE"
                row["reason"] = f"Market regime not bullish ({market_regime_val})"

            # Block new entries on validation errors (held positions keep their state)
            if not _vr.ok and not is_held and row.get("status") == "READY":
                row["status"] = "WATCH"
                row["reason"] = f"Validation error: {_vr.errors[0]}"

            out_rows.append(row)

        except Exception as e:
            skips.append({"ticker": t, "ticker_yf": tyf, "reason": f"EXCEPTION {type(e).__name__}"})
            continue

    # ==========================================================================
    # SYSTEM HARDENING: Print validation summary
    # ==========================================================================
    if validation_results:
        _val_summary = print_validation_summary(validation_results)
        # Flag held positions with errors prominently
        _held_errors = [r for r in validation_results if not r.ok and any(
            row.get("ticker") == r.ticker and row.get("is_held")
            for row in out_rows
        )]
        if _held_errors:
            print(f"\n{'='*60}")
            print(f"  WARNING: {len(_held_errors)} HELD position(s) have validation errors!")
            print(f"  REVIEW STOPS MANUALLY BEFORE TRADING")
            print(f"{'='*60}")
            for r in _held_errors:
                print(f"    {r.ticker}: {r.summary()}")
            print()

    out_df = pd.DataFrame(out_rows)

    # Add risk budget + sizing helper columns (informational; does not change classification logic)
    out_df, cap_info = add_risk_columns(
        out_df,
        args.risk_per_trade_pct,
        args.max_open_risk_pct,
        args.max_cluster_pct,
        skip_fx_lookup=args.skip_fx_lookup,
    )
    out_df = add_rank_score(out_df)

    # ==========================================================================
    # MODULE 10: MARKET BREADTH SAFETY VALVE (TIER 1: Use Universe)
    # ==========================================================================
    # Check market breadth using OUR UNIVERSE (not S&P sample)
    breadth_info = compute_market_breadth(universe_df=out_df)
    effective_max_positions = breadth_info["effective_max_positions"]
    
    # Add breadth columns to output
    out_df["market_breadth_pct"] = breadth_info["breadth_pct"]
    out_df["market_breadth_healthy"] = breadth_info["breadth_healthy"]
    out_df["effective_max_positions"] = effective_max_positions
    out_df["breadth_source"] = breadth_info.get("breadth_source", "universe")
    
    # ==========================================================================
    # MODULE 8: HEAT CHECK (Cluster Concentration Filter)
    # ==========================================================================
    if HEAT_CHECK_ENABLED:
        out_df["heat_check_blocked"] = False
        out_df["heat_check_reason"] = ""
        
        # Build cluster holdings count and average momentum for held positions
        held_df = out_df[out_df["is_held"].astype(bool)]
        cluster_holdings = held_df.groupby("cluster").size().to_dict()
        
        # Calculate average rank_score for held positions by cluster
        cluster_momentum_avg = {}
        for cluster in held_df["cluster"].unique():
            cluster_held = held_df[held_df["cluster"] == cluster]
            # For held positions, estimate rank from distance (lower = better)
            ranks = cluster_held["distance_to_20d_high_pct"].fillna(50) * 1000
            if len(ranks) > 0:
                cluster_momentum_avg[cluster] = ranks.mean()
        
        # Check each non-held candidate
        for idx, row in out_df.iterrows():
            if not row.get("is_held", False) and row.get("status") in ["READY", "WATCH"]:
                blocked, reason = check_heat_check(row.to_dict(), cluster_holdings, cluster_momentum_avg)
                if blocked:
                    out_df.loc[idx, "heat_check_blocked"] = True
                    out_df.loc[idx, "heat_check_reason"] = reason
                    # Downgrade READY to WATCH if blocked by heat check
                    if out_df.loc[idx, "status"] == "READY":
                        out_df.loc[idx, "status"] = "WATCH"
                        out_df.loc[idx, "reason"] = reason

    # ==========================================================================
    # MODULE 6: PRIORITY ENTRY (Top RS stocks when market flips to BULLISH)
    # ==========================================================================
    # Flag top RS stocks as PRIORITY_ENTRY if they're READY/WATCH
    if RS_RANKING_ENABLED and "rs_vs_benchmark" in out_df.columns:
        market_regime = market.get("market_regime", "UNKNOWN")
        out_df["is_priority_entry"] = False
        out_df["priority_entry_reason"] = ""
        
        # Only flag when market is BULLISH (these are the leaders emerging)
        if market_regime == "BULLISH":
            # Get non-held stocks with valid RS
            candidates = out_df[
                (~out_df["is_held"].astype(bool)) & 
                (out_df["status"].isin(["READY", "WATCH"])) &
                (out_df["rs_vs_benchmark"].notna())
            ].copy()
            
            if not candidates.empty:
                # Top N by RS (highest RS = best outperformers)
                top_rs = candidates.nlargest(RS_PRIORITY_COUNT, "rs_vs_benchmark")
                for idx in top_rs.index:
                    rs_val = top_rs.loc[idx, "rs_vs_benchmark"]
                    ticker = top_rs.loc[idx, "ticker"]
                    out_df.loc[idx, "is_priority_entry"] = True
                    out_df.loc[idx, "priority_entry_reason"] = f"RS Leader: +{rs_val*100:.1f}% vs benchmark"

    # ==========================================================================
    # MODULE 7: SWAP FOR LEADER (Cluster Quality Upgrade)
    # ==========================================================================
    if SWAP_LOGIC_ENABLED:
        out_df["is_swap_candidate"] = False
        out_df["swap_for_ticker"] = ""
        out_df["swap_reason"] = ""
        
        # Find clusters at cap
        held_df = out_df[out_df["is_held"].astype(bool)]
        # FIX: Filter ready_df by eligible_by_risk_caps to avoid suggesting blocked candidates
        eligible_filter = (out_df.get("eligible_by_risk_caps", pd.Series(True, index=out_df.index)) == True)
        ready_df = out_df[(~out_df["is_held"].astype(bool)) & (out_df["status"] == "READY") & eligible_filter]
        
        if not held_df.empty and not ready_df.empty:
            # Get cluster risk levels (from risk columns if available)
            cluster_at_cap = set()
            for cluster in held_df["cluster"].unique():
                cluster_risk = held_df[held_df["cluster"] == cluster].get("cluster_risk_pct", pd.Series([0])).iloc[0]
                if np.isfinite(cluster_risk) and cluster_risk >= args.max_cluster_pct * 0.9:  # 90% of cap = "at cap"
                    cluster_at_cap.add(cluster)
            
            # CLUSTER CAP SWAPS: Only when cluster is at cap
            if cluster_at_cap:
                for idx, row in held_df.iterrows():
                    should_swap, swap_reason, swap_ticker = check_swap_for_leader(
                        row.to_dict(), 
                        {},  # cluster_holdings not needed for this implementation
                        cluster_at_cap, 
                        ready_df
                    )
                    # Only apply cluster swap results (not laggard — handled below)
                    if should_swap and "LAGGARD" not in swap_reason:
                        out_df.loc[idx, "is_swap_candidate"] = True
                        out_df.loc[idx, "swap_for_ticker"] = swap_ticker
                        out_df.loc[idx, "swap_reason"] = swap_reason
                        if out_df.loc[idx, "held_action"] == "HOLD":
                            out_df.loc[idx, "held_action"] = "SWAP_FOR_LEADER"
                            out_df.loc[idx, "held_action_reason"] = swap_reason
            
            # LAGGARD SWAPS: Run for ALL held positions (cluster-independent)
            for idx, row in held_df.iterrows():
                if out_df.loc[idx, "is_swap_candidate"]:
                    continue  # Already flagged by cluster swap
                should_swap, swap_reason, swap_ticker = check_swap_for_leader(
                    row.to_dict(),
                    {},
                    set(),  # Empty cluster_at_cap — skips cluster swap, only laggard fires
                    ready_df
                )
                if should_swap:
                    out_df.loc[idx, "is_swap_candidate"] = True
                    out_df.loc[idx, "swap_for_ticker"] = swap_ticker
                    out_df.loc[idx, "swap_reason"] = swap_reason
                    if out_df.loc[idx, "held_action"] == "HOLD":
                        out_df.loc[idx, "held_action"] = "SWAP_FOR_LEADER"
                        out_df.loc[idx, "held_action_reason"] = swap_reason

    # Build active params dict for transparency
    active_params = get_active_params_dict(
        args, 
        cap_mode=cap_info["cap_mode"],
        position_count=cap_info["position_count"],
        MAX_POSITION_PCT_CORE=cap_info["MAX_POSITION_PCT_CORE"],
        MAX_POSITION_PCT_HIGH_RISK=cap_info["MAX_POSITION_PCT_HIGH_RISK"],
        MAX_SLEEVE_CORE=cap_info["MAX_SLEEVE_CORE"],
        MAX_SLEEVE_HIGH_RISK=cap_info["MAX_SLEEVE_HIGH_RISK"],
        MAX_SLEEVE_ETF=cap_info["MAX_SLEEVE_ETF"],
        effective_max_risk=cap_info["effective_max_risk"],
        breadth_info=breadth_info,  # MODULE 10: Include breadth info
    )

    # Warn if many tickers are UNCATEGORIZED (missing from super_cluster_map)
    if "super_cluster" in out_df.columns:
        uncategorized = out_df[out_df["super_cluster"] == "UNCATEGORIZED"]
        if len(uncategorized) > 10:
            print(f"[WARN] {len(uncategorized)} tickers have super_cluster=UNCATEGORIZED (missing from super_cluster_map.csv)")
            print(f"       They will share a 20% concentration cap. Consider mapping them.")
            print(f"       Examples: {uncategorized['ticker'].head(5).tolist()}")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_df.to_csv(out_path, index=False)
    # SQLite: persist full snapshot
    if _USE_SQLITE:
        try:
            _db.save_snapshot(out_df)
            _db.export_snapshot_csv(out_df, out_path)  # ensure CSV stays in sync
        except Exception as e:
            print(f"[DB] snapshot write failed: {e}")

    # --- PERSIST POSITIONS STATE (stateful stops, entry prices, etc.) ---
    try:
        positions_state_path = Path(args.positions_state)
        write_positions_state(positions_state_path, pos_state)
    except Exception as e:
        print(f"[WARN] Could not write positions_state.csv: {e}")

    card_path = Path(args.action_card)
    card_path.parent.mkdir(parents=True, exist_ok=True)
    if len(out_df):
        write_action_card(
            out_df,
            card_path,
            active_params=active_params,
            sanity_warnings=sanity_warnings,
            positions_state=pos_state,
            exclude_sells=exclude_sells,
        )

    # Write run metadata for reproducibility/debugging
    meta_path = Path(args.run_meta)
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta = {
        "version": VERSION,
        "run_utc": datetime.now(timezone.utc).isoformat(),
        "args": vars(args),
        "active_params": active_params,  # Full parameter snapshot for reproducibility
        "sanity_warnings": sanity_warnings,
        "counts": {
            "rows": int(len(out_df)),
            "skipped": int(len(skips)),
        },
        "market": {k: out_df.iloc[0].get(k) for k in out_df.columns if k.startswith("market_") or k.startswith("market2_")},
        "dropped_duplicates": dropped_dupes if "dropped_dupes" in locals() else [],
        "skips": skips[:50],  # cap size
    }
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    # SQLite: persist run meta
    if _USE_SQLITE:
        try:
            _db.save_run_meta(meta)
        except Exception as e:
            print(f"[DB] run_meta write failed: {e}")

    # --- LOG START: candidates blocked by risk caps (discipline log) ---
    try:
        log_path = Path("outputs/blocked_candidates_log.csv")
        today = datetime.now().date().isoformat()

        # Prefer ticker_yf if present
        tcol = "ticker_yf" if "ticker_yf" in out_df.columns else "ticker"

        blocked = out_df.copy()

        # Only log *new candidates* that are READY but blocked
        if "is_held" in blocked.columns:
            blocked = blocked[~blocked["is_held"].fillna(False).astype(bool)]

        if "status" in blocked.columns:
            blocked = blocked[blocked["status"].astype(str).str.upper().isin(["READY"])]

        if "risk_caps_block_reason" in blocked.columns:
            blocked = blocked[blocked["risk_caps_block_reason"].fillna("").astype(str).str.len() > 0]

        if not blocked.empty:
            blocked = blocked.copy()
            blocked["log_date"] = today

            keep_cols = [c for c in [
                "log_date", tcol, "sleeve", "regime", "status",
                "rank_score", "breakout_level", "stop_level",
                "risk_caps_block_reason"
            ] if c in blocked.columns]

            new_rows = blocked[keep_cols].copy()

            # Append and dedupe
            if log_path.exists():
                old = pd.read_csv(log_path)
                combined = pd.concat([old, new_rows], ignore_index=True)
                dedupe_cols = [c for c in ["log_date", tcol, "risk_caps_block_reason"] if c in combined.columns]
                if dedupe_cols:
                    combined = combined.drop_duplicates(subset=dedupe_cols, keep="last")
                combined.to_csv(log_path, index=False)
            else:
                new_rows.to_csv(log_path, index=False)
            # SQLite: persist blocked candidates
            if _USE_SQLITE:
                try:
                    _db.save_blocked_candidates(new_rows)
                except Exception as e2:
                    print(f"[DB] blocked_candidates write failed: {e2}")

    except Exception as e:
        print(f"[LOG] blocked_candidates_log failed: {e}")
    # --- LOG END ---

    # Health summary
    print(f"Created: {out_path}")
    print(f"Rows: {len(out_df)}")
    print(f"Action card: {card_path}")
    print(f"Market regime: {market.get('market_regime')} (benchmark={bench})")

    if skips:
        print(f"Skipped: {len(skips)} tickers (showing up to 12):")
        for r in skips[:12]:
            print(" -", r)

    if len(out_df):
        dq = out_df["data_quality_flag"].value_counts().to_dict() if "data_quality_flag" in out_df.columns else {}
        print("Data quality flags:", dq)
        stale_count = (out_df["data_age_days"] > args.max_data_age_days).sum() if "data_age_days" in out_df.columns else 0
        print("Stale rows kept:", int(stale_count))


if __name__ == "__main__":
    main()


