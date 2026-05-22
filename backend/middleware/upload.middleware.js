const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Dossiers de destination
const productDir = path.join(__dirname, '../uploads/products');
const avatarDir = path.join(__dirname, '../uploads/avatars');
const slideDir = path.join(__dirname, '../uploads/slides');
const pdvDocDir = path.join(__dirname, '../uploads/pdv-docs');

// Créer les dossiers s'ils n'existent pas
[productDir, avatarDir, slideDir, pdvDocDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Middleware pour les PRODUITS
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, productDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'product-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Middleware pour les AVATARS
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Middleware pour les SLIDES
const slideStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, slideDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'slide-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Middleware pour les DOCUMENTS PDV
const pdvDocStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdvDocDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'pdv-doc-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Seules les images et les PDF sont autorisés'));
};

const uploadProduct = multer({ 
  storage: productStorage, 
  limits: { fileSize: 5 * 1024 * 1024 }, 
  fileFilter 
});

const uploadAvatar = multer({ 
  storage: avatarStorage, 
  limits: { fileSize: 2 * 1024 * 1024 }, // Limite plus petite pour avatars (2MB)
  fileFilter 
});

const uploadSlide = multer({ 
  storage: slideStorage, 
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for high-quality banners
  fileFilter 
});

const uploadPDVDoc = multer({
  storage: pdvDocStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB pour les documents
  fileFilter
});

module.exports = { uploadProduct, uploadAvatar, uploadSlide, uploadPDVDoc };
