// In dev, /uploads is proxied by Vite. If VITE_API_URL points at another host, images come from there too.
const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/api\/?$/, '');

export const imageUrl = (path) => (path ? ORIGIN + path : '');

// Shows the product picture, or the product's initials when it has none
export default function ProductImage({ product, size = 44, className = '' }) {
  const initials = (product.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (product.image) {
    return (
      <img
        className={`product-img ${className}`}
        src={imageUrl(product.image)}
        alt={product.name}
        loading="lazy"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`product-img placeholder ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
