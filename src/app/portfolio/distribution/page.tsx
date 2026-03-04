import { redirect } from 'next/navigation';

export default function DistributionPage() {
  redirect('/portfolio/positions?tab=distribution');
}
