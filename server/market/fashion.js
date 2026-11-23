// The Fashion page: clothes shown by type (Shirts, Dresses, Watches…), in groups.
// Each section is one sub-category, optionally narrowed to some "Type" values (attrs.item).
const text = (key, name, icon, category, sub, items = null) => ({ key, name, icon, category, sub, items });

const FASHION = [
  { group: 'Women', icon: '👗', sections: [
    text('womens-wear', 'All women’s wear', '👚', 'clothes-shoes', 'womens-clothes'),
    text('dresses', 'Dresses', '👗', 'clothes-shoes', 'womens-clothes', ['Dresses']),
    text('tops', 'Tops & blouses', '👚', 'clothes-shoes', 'womens-clothes', ['Tops & blouses', 'Shirts', 'T-shirts']),
    text('skirts', 'Skirts', '🩱', 'clothes-shoes', 'womens-clothes', ['Skirts']),
    text('womens-trousers', 'Women’s trousers & jeans', '👖', 'clothes-shoes', 'womens-clothes', ['Trousers & jeans']),
    text('kitenge', 'Kitenge & ankara', '🌺', 'clothes-shoes', 'womens-clothes', ['Kitenge & ankara']),
    text('womens-suits', 'Women’s suits & blazers', '🧥', 'clothes-shoes', 'womens-clothes', ['Suits & blazers', 'Jackets & coats']),
  ] },
  { group: 'Men', icon: '👔', sections: [
    text('mens-wear', 'All men’s wear', '🧑', 'clothes-shoes', 'mens-clothes'),
    text('shirts', 'Shirts', '👔', 'clothes-shoes', 'mens-clothes', ['Shirts']),
    text('tshirts', 'T-shirts & polos', '👕', 'clothes-shoes', 'mens-clothes', ['T-shirts & polos']),
    text('trousers', 'Trousers & jeans', '👖', 'clothes-shoes', 'mens-clothes', ['Trousers & chinos', 'Jeans']),
    text('suits', 'Suits & blazers', '🤵', 'clothes-shoes', 'mens-clothes', ['Suits & blazers']),
    text('jackets', 'Jackets & hoodies', '🧥', 'clothes-shoes', 'mens-clothes', ['Jackets & coats', 'Sweaters & hoodies']),
  ] },
  { group: 'Shoes', icon: '👟', sections: [
    text('womens-shoes', 'Women’s shoes', '👠', 'clothes-shoes', 'womens-shoes'),
    text('mens-shoes', 'Men’s shoes', '👞', 'clothes-shoes', 'mens-shoes'),
    text('sneakers', 'Men’s sneakers', '👟', 'clothes-shoes', 'mens-shoes', ['Sneakers', 'Sports shoes']),
    text('heels', 'Heels', '👠', 'clothes-shoes', 'womens-shoes', ['Heels', 'Wedges']),
  ] },
  { group: 'Watches & accessories', icon: '⌚', sections: [
    text('watches', 'Watches', '⌚', 'clothes-shoes', 'watches-jewellery', ['Men’s watches', 'Women’s watches', 'Smart watches']),
    text('jewellery', 'Jewellery', '💍', 'clothes-shoes', 'watches-jewellery', ['Necklaces & chains', 'Earrings', 'Rings', 'Bracelets & bangles']),
    text('accessories', 'Sunglasses, belts & caps', '🕶️', 'clothes-shoes', 'watches-jewellery', ['Sunglasses', 'Belts, caps & ties']),
    text('handbags', 'Handbags & purses', '👜', 'bags', 'handbags'),
  ] },
  { group: 'Sports & kids', icon: '⚽', sections: [
    text('sportswear', 'Sportswear', '⚽', 'clothes-shoes', 'sportswear'),
    text('kids-clothes', 'Kids’ clothes', '🧒', 'baby-kids', 'kids-clothes'),
    text('kids-shoes', 'Kids’ shoes', '👟', 'baby-kids', 'kids-shoes'),
  ] },
];

const filterFor = (input) => ({ category: input.category, sub: input.sub, ...(input.items ? { 'attrs.item': input.items.length > 1 ? { $in: input.items } : input.items[0] } : {}) });
const linkFor = (url) => `/market/${url.category}/${url.sub}${url.items ? `?item=${encodeURIComponent(url.items.join('|'))}` : ''}`;

// boutiques near me: which ads count as men's / women's wear
const WEAR = {
  men: { name: 'Men’s wear', filter: { category: 'clothes-shoes', $or: [{ sub: { $in: ['mens-clothes', 'mens-shoes'] } }, { sub: 'watches-jewellery', 'attrs.item': 'Men’s watches' }, { 'attrs.gender': 'Men' }] } },
  women: { name: 'Women’s wear', filter: { $or: [{ category: 'clothes-shoes', sub: { $in: ['womens-clothes', 'womens-shoes'] } }, { category: 'clothes-shoes', 'attrs.gender': 'Women' }, { category: 'clothes-shoes', sub: 'watches-jewellery', 'attrs.item': 'Women’s watches' }, { category: 'bags', sub: 'handbags' }] } },
  all: { name: 'Clothes & fashion', filter: { category: { $in: ['clothes-shoes', 'bags'] } } },
};

module.exports = { FASHION, filterFor, linkFor, WEAR };
