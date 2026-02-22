import { redirect } from 'next/navigation';

/**
 * Portfolio root — redirects to /portfolio/positions.
 * The portfolio section uses sub-routes (positions, distribution).
 */
export default function PortfolioPage() {
  redirect('/portfolio/positions');
}
