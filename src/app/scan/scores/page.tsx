import { redirect } from 'next/navigation';

export default function ScoresPage() {
  redirect('/scan?tab=scores');
}
