import { ProductSkeleton } from '../../../../components/skeletons';

/**
 * Its own file, not inherited from `/store/loading.tsx`: a product page
 * waiting under a grid of card placeholders would be the wrong shape.
 */
export default function Loading() {
  return <ProductSkeleton />;
}
