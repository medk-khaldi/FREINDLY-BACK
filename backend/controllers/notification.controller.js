const Notification = require("../models/Notification");
const Utilisateur = require("../models/Utilisateur");

// Créer une notification
exports.createNotification = async (req, res) => {
  try {
    const { userId, type, title, message, data } = req.body;

    // Vérifier que l'utilisateur existe
    const user = await Utilisateur.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Utilisateur introuvable" });
    }

    const notification = new Notification({
      userId,
      type,
      title,
      message,
      data
    });

    await notification.save();

    console.log(`📢 Notification créée pour ${user.username}: ${title}`);

    res.status(201).json({
      message: "Notification créée avec succès",
      notification
    });
  } catch (err) {
    console.error("❌ Erreur création notification:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Obtenir les notifications d'un utilisateur
exports.getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, page = 1, unreadOnly = false } = req.query;

    const query = { userId };
    if (unreadOnly === 'true') {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('data.deliveryId', 'numero_livraison')
      .populate('data.commandeId', 'numero_commande')
      .populate('data.voyageId', 'numero_voyage');

    const totalCount = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ userId, read: false });

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      unreadCount
    });
  } catch (err) {
    console.error("❌ Erreur récupération notifications:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Marquer une notification comme lue
exports.markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification introuvable" });
    }

    res.json({
      message: "Notification marquée comme lue",
      notification
    });
  } catch (err) {
    console.error("❌ Erreur marquage notification:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Marquer toutes les notifications comme lues pour un utilisateur
exports.markAllAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await Notification.updateMany(
      { userId, read: false },
      { read: true }
    );

    res.json({
      message: "Toutes les notifications marquées comme lues",
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error("❌ Erreur marquage toutes notifications:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Supprimer une notification
exports.deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findByIdAndDelete(notificationId);

    if (!notification) {
      return res.status(404).json({ message: "Notification introuvable" });
    }

    res.json({ message: "Notification supprimée" });
  } catch (err) {
    console.error("❌ Erreur suppression notification:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
};

// Fonction utilitaire pour créer des notifications spécifiques
exports.createDeliveryNotification = async (chauffeurId, delivery, type, additionalData = {}) => {
  try {
    const titles = {
      NEW_DELIVERY: 'Nouvelle livraison assignée',
      ADDRESS_CHANGE: 'Adresse modifiée',
      DELIVERY_CANCELLED: 'Livraison annulée'
    };

    const clientName = delivery.commande?.pointDeVente?.nom || 'Client';
    const address = delivery.commande?.pointDeVente?.adresse || '';

    const messages = {
      NEW_DELIVERY: `Nouvelle livraison pour ${clientName}${address ? ` - ${address}` : ''}`,
      ADDRESS_CHANGE: `L'adresse de livraison pour ${clientName} a été modifiée : ${address}`,
      DELIVERY_CANCELLED: `La livraison pour ${clientName} a été annulée`
    };

    const notification = new Notification({
      userId: chauffeurId,
      type,
      title: titles[type] || 'Notification',
      message: messages[type] || 'Vous avez une nouvelle notification',
      data: {
        deliveryId: delivery._id,
        commandeId: delivery.commande?._id,
        pointDeVente: clientName,
        ...additionalData
      }
    });

    await notification.save();
    console.log(`📢 Notification ${type} créée pour chauffeur ${chauffeurId}`);
    
    return notification;
  } catch (err) {
    console.error("❌ Erreur création notification livraison:", err);
    throw err;
  }
};

exports.createVoyageNotification = async (chauffeurId, voyage, type) => {
  try {
    const titles = {
      VOYAGE_ASSIGNED: 'Nouveau voyage assigné',
      VOYAGE_CANCELLED: 'Voyage annulé'
    };

    const messages = {
      VOYAGE_ASSIGNED: `Un nouveau voyage vous a été assigné avec ${voyage.livraisons?.length || 0} livraison(s)`,
      VOYAGE_CANCELLED: `Votre voyage prévu pour le ${new Date(voyage.date_depart).toLocaleDateString('fr-FR')} a été annulé`
    };

    const notification = new Notification({
      userId: chauffeurId,
      type,
      title: titles[type] || 'Notification',
      message: messages[type] || 'Vous avez une nouvelle notification',
      data: {
        voyageId: voyage._id,
        deliveryCount: voyage.livraisons?.length || 0
      }
    });

    await notification.save();
    console.log(`📢 Notification ${type} créée pour chauffeur ${chauffeurId}`);
    
    return notification;
  } catch (err) {
    console.error("❌ Erreur création notification voyage:", err);
    throw err;
  }
};

/**
 * Envoyer une notification à tous les responsables d'entrepôt
 */
exports.notifyAllResponsables = async (type, title, message, data = {}) => {
  try {
    const responsables = await Utilisateur.find({ role: 'responsableEntrepot' }).select('_id username');
    if (responsables.length === 0) return;

    const notifications = responsables.map(u => ({
      userId: u._id,
      type,
      title,
      message,
      data
    }));

    await Notification.insertMany(notifications);
    console.log(`📢 Notification "${type}" envoyée à ${responsables.length} responsable(s)`);
  } catch (err) {
    console.error("❌ Erreur notifyAllResponsables:", err);
    // Ne jamais bloquer l'opération principale
  }
};

/**
 * Envoyer une notification à tous les admins (superviseurs)
 */
exports.notifyAllAdmins = async (type, title, message, data = {}) => {
  try {
    const admins = await Utilisateur.find({ role: 'admin' }).select('_id username');
    if (admins.length === 0) return;

    const notifications = admins.map(u => ({
      userId: u._id,
      type,
      title,
      message,
      data
    }));

    await Notification.insertMany(notifications);
    console.log(`📢 Notification "${type}" envoyée à ${admins.length} admin(s)`);
  } catch (err) {
    console.error("❌ Erreur notifyAllAdmins:", err);
    // Ne jamais bloquer l'opération principale
  }
};

/**
 * Notifier tous les responsables d'une nouvelle commande client marketplace
 */
exports.notifyNewCommandeClient = async (commande, client, forcedTotal = null) => {
  try {
    const clientName = client
      ? `${client.prenom || ''} ${client.nom || ''}`.trim() || client.email || 'Client inconnu'
      : 'Client inconnu';

    const ville = commande.adresse_livraison?.gouvernorat || commande.adresse_livraison?.delegation || '';
    const nbArticles = commande.lignesCommande?.length || 0;
    
    // Utiliser le total forcé (venant du body) ou essayer de le trouver dans l'objet
    const totalValue = forcedTotal !== null ? forcedTotal : (commande.montant_total || commande.total || 0);

    const title = `🛒 Nouvelle commande marketplace`;
    const message = `${clientName} vient de passer une commande${ville ? ` depuis ${ville}` : ''} — ${nbArticles} article(s) — ${parseFloat(totalValue).toFixed(3).replace('.', ',')} DT`;

    await exports.notifyAllResponsables('NEW_COMMANDE_CLIENT', title, message, {
      commandeId: commande._id
    });

    await exports.notifyAllAdmins('NEW_COMMANDE_CLIENT', title, message, {
      commandeId: commande._id
    });

    console.log(`📢 Notification nouvelle commande envoyée aux responsables pour commande ${commande._id} (Total: ${totalValue})`);
  } catch (err) {
    console.error('❌ Erreur notifyNewCommandeClient:', err);
    // Ne jamais bloquer l'opération principale
  }
};

/**
 * Créer une notification pour un nouveau message de chat
 */
exports.createMessageNotification = async (userId, message) => {
  try {
    const notification = new Notification({
      userId,
      type: 'NEW_MESSAGE',
      title: `💬 Message de ${message.senderName}`,
      message: message.content.length > 100 ? message.content.substring(0, 97) + '...' : message.content,
      data: {
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: message.senderName
      }
    });

    await notification.save();
    console.log(`📢 Notification NEW_MESSAGE créée pour ${userId}`);
    return notification;
  } catch (err) {
    console.error('❌ Erreur createMessageNotification:', err);
  }
};

/**
 * Notifier tous les admins d'une nouvelle inscription (Staff ou PDV)
 */
exports.notifyNewRegistration = async (user, type = 'STAFF') => {
  try {
    const isPDV = type === 'PDV';
    const title = isPDV ? '🏪 Nouveau Point de Vente à valider' : '👥 Nouveau membre staff à valider';
    
    let displayName = "";
    if (isPDV) {
      displayName = user.nom || user.magasin_nom || "Un nouveau magasin";
    } else {
      displayName = user.username || `${user.prenom || ''} ${user.nom || ''}`.trim() || "Un nouvel utilisateur";
    }

    const message = isPDV 
      ? `${displayName} vient de vérifier son email et attend votre validation.`
      : `${displayName} (${user.role || 'en_attente'}) attend votre validation de compte.`;

    await exports.notifyAllAdmins('NEW_USER_REGISTRATION', title, message, {
      userId: user._id,
      userType: type,
      pointDeVente: isPDV ? displayName : undefined
    });

    console.log(`📢 Notification de nouvelle inscription (${type}) envoyée aux admins pour ${displayName}`);
  } catch (err) {
    console.error('❌ Erreur notifyNewRegistration:', err);
  }
};