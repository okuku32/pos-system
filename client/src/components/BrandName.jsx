import { STORE_INFO, isOrdersasa } from '../shop/storeInfo';

export default function BrandName({ accent = '#ff7a45' }) {
  if (isOrdersasa()) return <>Order<span style={{ color: accent }}>sasa</span></>;
  return <>{STORE_INFO.name}</>;
}
