const express = require('express');
const router = express.Router();
const messagingController = require('../controllers/messaging.controller');
const authMiddleware = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuration Multer pour les médias du chat
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/chat/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `chat-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Toutes les routes sont protégées
router.use(authMiddleware);

// Conversations
router.get('/conversations', messagingController.getConversations);
router.post('/conversations', messagingController.getOrCreateConversation);
router.get('/conversations/support/available-staff', messagingController.getAvailableStaff);
router.post('/conversations/support/init', messagingController.getOrCreateSupportConversation);
router.get('/conversations/support/check', messagingController.checkSupportConversation);
router.post('/conversations/support/close', messagingController.closeSupportConversation);
router.post('/conversations/support/:conversationId/rate', messagingController.rateSupportConversation);
router.post('/conversations/support/escalate', messagingController.escalateSupportConversation);
router.get('/conversations/support', messagingController.getSupportConversations);
router.patch('/conversations/:conversationId/read', messagingController.markAsRead);

// Messages
router.get('/conversations/:conversationId/messages', messagingController.getMessages);

// Contacts
router.get('/contacts', messagingController.getContacts);

// Upload Media (pour les envoyer via socket après)
router.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Aucun fichier téléchargé" });
  }
  
  res.status(200).json({
    url: `/api/uploads/chat/${req.file.filename}`,
    name: req.file.originalname,
    type: req.file.mimetype,
    size: req.file.size
  });
});

module.exports = router;
