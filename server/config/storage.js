// Where files are kept on the server: public photos (uploads) and private files (riders' documents, shopping-list
// photos, backups). By default inside the server folder. On a host with a separate persistent disk (Render, Railway,
// Fly.io…), set DATA_DIR to the disk's mount path and both live there, so they survive deploys and restarts:
//   DATA_DIR=/var/data   →   /var/data/uploads  and  /var/data/private
const path = require('path');

const dataDirectory = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..');
const UPLOADS_DIR = path.join(dataDirectory, 'uploads');
const PRIVATE_DIR = path.join(dataDirectory, 'private');

module.exports = { UPLOADS_DIR, PRIVATE_DIR };
