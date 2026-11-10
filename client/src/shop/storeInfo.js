// Shop location and contact details, shown on the Help page, in the footer and in the chat.
// Fill in phone / email / hours when you have them; anything left empty is simply not shown.
export const STORE_INFO = {
  name: 'Ordersasa',
  location: 'Imara Mall',
  address: 'Imara Mall, Mombasa Road, Imara Daima, Nairobi',
  mapQuery: 'Imara Mall, Mombasa Road, Nairobi',
  phone: '', // e.g. '0712 345 678'
  whatsapp: '', // e.g. '254712345678' (digits only)
  email: '', // e.g. 'hello@ordersasa.co.ke'
  hours: [], // e.g. [['Mon – Sat', '8:00 am – 9:00 pm'], ['Sunday', '10:00 am – 6:00 pm']]
};

export const mapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(STORE_INFO.mapQuery)}&output=embed`;
export const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(STORE_INFO.mapQuery)}`;
