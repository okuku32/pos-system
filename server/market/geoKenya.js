// Is a point in Kenya (a generous box around the country)?
const inKenya = (lat, lng) => lat >= -5.2 && lat <= 5.5 && lng >= 33.4 && lng <= 42.4;
module.exports = { inKenya };
