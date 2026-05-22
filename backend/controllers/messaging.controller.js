const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/Utilisateur');
const Client = require('../models/Client');
const mongoose = require('mongoose');

// 🔹 HELPER: BATCH POPULATE PARTICIPANTS
async function populateConversationParticipants(conversations) {
  if (!conversations || conversations.length === 0) return [];

  const userIds = new Set();
  const clientIds = new Set();

  // 1. Collect all IDs
  conversations.forEach(conv => {
    conv.participants.forEach(p => {
      if (p.userModel === 'Utilisateur') userIds.add(p.userId.toString());
      else clientIds.add(p.userId.toString());
    });
  });

  // 2. Fetch in batch
  const [users, clients] = await Promise.all([
    User.find({ _id: { $in: Array.from(userIds) } }).select('username profileImage nom prenom role isOnline lastSeen').lean(),
    Client.find({ _id: { $in: Array.from(clientIds) } }).select('username nom prenom profileImage email').lean()
  ]);

  // 3. Create maps for quick lookup
  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  const clientMap = new Map(clients.map(c => [c._id.toString(), c]));

  // 4. Map back to participants
  conversations.forEach(conv => {
    conv.participants.forEach(p => {
      const id = p.userId.toString();
      if (p.userModel === 'Utilisateur') {
        const u = userMap.get(id);
        if (u) {
          p.userName = u.username;
          p.userPhoto = u.profileImage;
          p.fullName = `${u.prenom || ''} ${u.nom || ''}`.trim();
          p.isOnline = u.isOnline;
          p.lastSeen = u.lastSeen;
        }
      } else {
        const c = clientMap.get(id);
        if (c) {
          p.userName = c.username || c.email;
          p.userPhoto = c.profileImage;
          p.fullName = `${c.prenom || ''} ${c.nom || ''}`.trim();
        }
      }
    });
  });

  return conversations;
}

// 🔹 GET ALL CONVERSATIONS FOR LOGGED IN USER
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    
    const conversations = await Conversation.find({
      'participants.userId': userObjectId,
      isActive: true
    }).sort({ updatedAt: -1 }).lean();

    await populateConversationParticipants(conversations);
    
    const formattedConversations = conversations.map(conv => ({
      ...conv,
      unreadCount: conv.unreadCount ? (conv.unreadCount[userId] || 0) : 0
    }));

    res.status(200).json(formattedConversations);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des conversations", error: error.message });
  }
};

// 🔹 GET MESSAGES FOR A CONVERSATION
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, skip = 0 } = req.query;

    const messages = await Message.find({ conversationId, isDeleted: false })
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    res.status(200).json(messages.reverse());
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des messages", error: error.message });
  }
};

// 🔹 START OR GET DIRECT CONVERSATION
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { participantId, participantModel } = req.body;
    const currentUserId = req.user.id;
    const currentUserModel = req.user.userType === 'client' ? 'Client' : 'Utilisateur';

    // Find if a direct conversation already exists between these two
    let conversation = await Conversation.findOne({
      type: 'direct',
      'participants.userId': { $all: [currentUserId, participantId] }
    });

    if (!conversation) {
      // Get participant info to store roles if needed
      let participantInfo;
      if (participantModel === 'Utilisateur') {
        participantInfo = await User.findById(participantId);
      } else {
        participantInfo = await Client.findById(participantId);
      }

      const currentUserInfo = req.user.userType === 'client' 
        ? await Client.findById(currentUserId) 
        : await User.findById(currentUserId);

      conversation = new Conversation({
        type: 'direct',
        participants: [
          { 
            userId: currentUserId, 
            userModel: currentUserModel,
            role: currentUserInfo.role || 'client'
          },
          { 
            userId: participantId, 
            userModel: participantModel,
            role: participantInfo.role || 'client'
          }
        ]
      });
      await conversation.save();
    }

    // Batch populate participants for the single returned conversation
    const convArray = [conversation.toObject()];
    await populateConversationParticipants(convArray);

    res.status(200).json(convArray[0]);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la création de la conversation", error: error.message });
  }
};

// 🔹 GET CONTACTS LIST BASED ON ROLE
exports.getContacts = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    const userRole = req.user.role;

    // Staff can see all other staff
    // In this specific implementation, we fetch all users except the current one
    const contacts = await User.find({
      _id: { $ne: currentUserId },
      role: { $in: ['admin', 'responsableEntrepot', 'chauffeur'] }
    }).select('username nom prenom email role profileImage isOnline lastSeen');

    res.status(200).json(contacts);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des contacts", error: error.message });
  }
};

// 🔹 MARK MESSAGES AS READ
exports.markAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const userModel = req.user.userType === 'client' ? 'Client' : 'Utilisateur';

    // Update unread count in conversation
    await Conversation.findByIdAndUpdate(conversationId, {
      [`unreadCount.${userId}`]: 0
    });

    // Update messages to add current user to readBy
    await Message.updateMany(
      { 
        conversationId, 
        'readBy.userId': { $ne: userObjectId },
        senderId: { $ne: userObjectId }
      },
      { 
        $push: { readBy: { userId: userObjectId, userModel, readAt: new Date() } } 
      }
    );

    // Notify other participants via socket
    const io = req.app.get('io');
    if (io) {
      io.of('/messaging').to(conversationId).emit('messages_read', {
        conversationId,
        readerId: userId,
        readAt: new Date()
      });
    }

    res.status(200).json({ message: "Messages marqués comme lus" });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors du marquage des messages", error: error.message });
  }
};

// 🔹 CHECK IF CLIENT HAS AN ACTIVE SUPPORT CHAT
exports.checkSupportConversation = async (req, res) => {
  try {
    const clientId = req.user.id;
    const conversation = await Conversation.findOne({
      type: 'support',
      'participants.userId': new mongoose.Types.ObjectId(clientId),
      'metadata.status': 'open'
    });

    if (!conversation) {
      return res.status(200).json(null);
    }

    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 START OR GET SUPPORT CONVERSATION (For Clients)
exports.getOrCreateSupportConversation = async (req, res) => {
  try {
    const PointDeVente = require('../models/PointDeVente');
    const clientId = req.user.id;
    const clientEmail = req.user.email;
    const userType = req.user.userType || req.user.role;
    const { topic } = req.body;

    // Fetch full user from DB to get telephone and display name
    let fullUser;
    let clientUsername = '';
    let clientPhone = '';
    let clientName = '';

    if (userType === 'pdv') {
      fullUser = await PointDeVente.findById(clientId).select('nom telephone email');
      if (fullUser) {
        clientUsername = fullUser.nom; // nom boutique
        clientPhone = fullUser.telephone || '';
        clientName = fullUser.nom;
      }
    } else {
      fullUser = await Client.findById(clientId).select('nom prenom telephone email');
      if (fullUser) {
        clientUsername = `${fullUser.prenom || ''} ${fullUser.nom || ''}`.trim();
        clientPhone = fullUser.telephone || '';
        clientName = clientUsername || clientEmail;
      }
    }

    if (!clientName) clientName = req.user.email;
    if (!clientUsername) clientUsername = req.user.email;

    console.log(`🔍 [SUPPORT_INIT] Client ID: ${clientId} (${clientUsername}), Topic: ${topic}`);

    const clientObjectId = new mongoose.Types.ObjectId(clientId);

    // Close any existing open support conversations for this client (they're starting fresh)
    await Conversation.updateMany(
      {
        type: 'support',
        'participants.userId': clientObjectId,
        'metadata.status': 'open'
      },
      { $set: { 'metadata.status': 'closed', 'metadata.closedAt': new Date() } }
    );

    console.log(`🆕 [SUPPORT_INIT] Creating brand new support conversation for client ${clientId}`);
    
    // Find an online responsable to assign
    let assignedAgent = await User.findOne({ 
      role: { $in: ['responsableEntrepot', 'admin'] },
      isOnline: true 
    });

    // Fallback to any random responsable if no one is online
    if (!assignedAgent) {
      assignedAgent = await User.findOne({ 
        role: { $in: ['responsableEntrepot', 'admin'] } 
      });
    }

    conversation = new Conversation({
      type: 'support',
      participants: [
        { userId: clientObjectId, userModel: 'Client' }
      ],
      metadata: {
        clientEmail,
        clientName,
        clientUsername,
        clientPhone,
        status: 'open',
        topic: topic || 'Général',
        assignedTo: assignedAgent ? assignedAgent._id : null
      }
    });

    // Add agent to participants if found
    if (assignedAgent) {
      conversation.participants.push({ 
        userId: assignedAgent._id, 
        userModel: 'Utilisateur',
        role: assignedAgent.role
      });
    }

    await conversation.save();

    // Hardcoded welcome message — no AI call needed for a simple greeting
    const aiResponseContent = `Bonjour ! Comment puis-je vous aider ?`;
    
    try {
      
      const aiMessage = new Message({
        conversationId: conversation._id,
        senderId: new mongoose.Types.ObjectId('000000000000000000000001'),
        senderModel: 'AI',
        senderName: 'Assistant IA',
        senderRole: 'bot',
        content: aiResponseContent,
        type: 'text',
        readBy: []
      });

      await aiMessage.save();

      conversation.lastMessage = {
        content: aiResponseContent,
        type: 'text',
        senderId: aiMessage.senderId,
        createdAt: aiMessage.createdAt
      };
      await conversation.save();
    } catch (aiErr) {
      console.error("❌ [AI_WELCOME] Error generating initial AI message:", aiErr);
    }

    res.status(200).json(conversation);
  } catch (error) {
    console.error(`❌ [SUPPORT_INIT] Error: ${error.message}`);
    res.status(500).json({ message: "Erreur lors de la création du chat support", error: error.message });
  }
};

// 🔹 CLOSE SUPPORT CONVERSATION
exports.closeSupportConversation = async (req, res) => {
  try {
    const { conversationId } = req.body;
    const conversation = await Conversation.findById(conversationId);
    
    if (!conversation) return res.status(404).json({ message: "Conversation non trouvée" });

    conversation.metadata.status = 'closed';
    conversation.metadata.closedAt = new Date();
    await conversation.save();

    res.status(200).json({ message: "Conversation fermée", conversation });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la fermeture", error: error.message });
  }
};

// 🔹 RATE SUPPORT CONVERSATION
exports.rateSupportConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { rating } = req.body;

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: "Conversation non trouvée" });

    conversation.metadata.rating = rating;
    conversation.markModified('metadata');
    await conversation.save();

    res.status(200).json({ message: "Évaluation enregistrée", conversation });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'évaluation", error: error.message });
  }
};

// 🔹 ESCALATE SUPPORT CONVERSATION
exports.escalateSupportConversation = async (req, res) => {
  try {
    const { conversationId, reason } = req.body;
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: "Conversation non trouvée" });

    conversation.metadata.escalatedAt = new Date();
    conversation.metadata.escalatedReason = reason || "Escalade manuelle/IA";
    await conversation.save();

    res.status(200).json({ message: "Escalade enregistrée", conversation });
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de l'escalade", error: error.message });
  }
};

// 🔹 GET SUPPORT CONVERSATIONS (For Responsables)
exports.getSupportConversations = async (req, res) => {
  try {
    if (req.user.role !== 'responsableEntrepot' && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Accès refusé" });
    }

    const conversations = await Conversation.find({
      type: 'support',
      isActive: true
    }).sort({ updatedAt: -1 }).lean();

    await populateConversationParticipants(conversations);

    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ message: "Erreur lors de la récupération des conversations support", error: error.message });
  }
};

// 🔹 GET AVAILABLE STAFF FOR SUPPORT
exports.getAvailableStaff = async (req, res) => {
  try {
    const staff = await User.find({
      role: { $in: ['admin', 'responsableEntrepot'] },
      isOnline: true
    }).select('username profileImage nom prenom role lastSeen');

    res.status(200).json(staff);
  } catch (error) {
    console.error("❌ Error fetching available staff:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
};
