import { redirect } from 'next/navigation';

export default function PerformancePage() {
  redirect('/portfolio/positions?tab=performance');
}
