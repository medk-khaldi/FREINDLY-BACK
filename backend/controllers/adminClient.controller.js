const Client = require("../models/Client");

// 🔹 Obtenir tous les clients (Admin)
exports.getAllClients = async (req, res) => {
  try {
    const clients = await Client.find().select("-password");
    res.json(clients);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 Obtenir un client par ID (Admin)
exports.getClientById = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select("-password");
    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 Mettre à jour un client (Admin)
exports.updateClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).select("-password");
    
    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }
    res.json(client);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// 🔹 Activer/Désactiver un client (Admin)
exports.toggleClientStatus = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ message: "Client introuvable" });
    }
    
    client.isActive = !client.isActive;
    await client.save();
    
    res.json({ 
      message: `Client ${client.isActive ? 'activé' : 'désactivé'} avec succès`,
      isActive: client.isActive 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
