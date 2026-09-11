import { redirect } from 'next/navigation';

/**
 * The panel opens on the queue, not the catalog.
 *
 * That is the screen with time-sensitive work on it: every line waiting there
 * is a customer who has already paid. Product editing can wait a minute;
 * somebody's licence cannot.
 */
export default function AdminHome() {
  redirect('/queue');
}
