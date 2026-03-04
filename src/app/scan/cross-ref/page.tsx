import { redirect } from 'next/navigation';

export default function CrossRefPage() {
  redirect('/scan?tab=cross-ref');
}
