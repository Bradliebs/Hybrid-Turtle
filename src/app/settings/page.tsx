'use client';

import Navbar from '@/components/shared/Navbar';
import AccountPanel from '@/components/settings/AccountPanel';
import BrokerPanel from '@/components/settings/BrokerPanel';
import NotificationsPanel from '@/components/settings/NotificationsPanel';
import DataPanel from '@/components/settings/DataPanel';
import SystemPanel from '@/components/settings/SystemPanel';
import { Settings as SettingsIcon, Link } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              <SettingsIcon className="w-6 h-6 text-primary-400" />
              Settings
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configure your HybridTurtle trading system
            </p>
          </div>
          <a
            href="/user-guide.md"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg border border-white/10 text-sm text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <Link className="w-4 h-4" />
            Open User Guide
          </a>
        </div>
        <AccountPanel />
        <BrokerPanel />
        <NotificationsPanel />
        <DataPanel />
        <SystemPanel />
      </main>
    </div>
  );
}