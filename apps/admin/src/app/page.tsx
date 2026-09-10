import { redirect } from 'next/navigation';

/**
 * There is no admin dashboard yet, and an empty one would be a landing page
 * nobody wants: the panel opens on the products list, which bounces to the
 * sign-in screen when there is no session.
 */
export default function AdminHome() {
  redirect('/products');
}
