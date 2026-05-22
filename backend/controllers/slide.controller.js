const Slide = require('../models/Slide');
const fs = require('fs');
const path = require('path');

// GET all slides (admin)
exports.getAllSlides = async (req, res) => {
  try {
    const slides = await Slide.find().sort({ ordre: 1 });
    res.json(slides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET active slides (client)
exports.getActiveSlides = async (req, res) => {
  try {
    const slides = await Slide.find({ actif: true }).sort({ ordre: 1 });
    res.json(slides);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// CREATE slide
exports.createSlide = async (req, res) => {
  try {
    const { titre, sousTitre, badge, lienBouton, texteBouton, ordre, actif, imagePosition } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ message: "L'image de fond est requise" });
    }

    const slide = new Slide({
      titre,
      sousTitre,
      badge,
      image: `slides/${req.file.filename}`,
      lienBouton,
      texteBouton,
      ordre,
      actif,
      imagePosition
    });

    const newSlide = await slide.save();
    res.status(201).json(newSlide);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// UPDATE slide
exports.updateSlide = async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) return res.status(404).json({ message: "Slide non trouvé" });

    const updates = { ...req.body };
    
    if (req.file) {
      // Delete old image
      const oldImagePath = path.join(__dirname, '../uploads', slide.image);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
      updates.image = `slides/${req.file.filename}`;
    }

    const updatedSlide = await Slide.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(updatedSlide);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// DELETE slide
exports.deleteSlide = async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) return res.status(404).json({ message: "Slide non trouvé" });

    // Delete image file
    const imagePath = path.join(__dirname, '../uploads', slide.image);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    await Slide.findByIdAndDelete(req.params.id);
    res.json({ message: "Slide supprimé" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// TOGGLE status
exports.toggleSlideStatus = async (req, res) => {
  try {
    const slide = await Slide.findById(req.params.id);
    if (!slide) return res.status(404).json({ message: "Slide non trouvé" });

    slide.actif = !slide.actif;
    await slide.save();
    res.json(slide);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// REORDER slides
exports.reorderSlides = async (req, res) => {
  try {
    const { orders } = req.body; // Array of { id, ordre }
    
    const updatePromises = orders.map(item => 
      Slide.findByIdAndUpdate(item.id, { ordre: item.ordre })
    );

    await Promise.all(updatePromises);
    res.json({ message: "Ordre mis à jour" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
