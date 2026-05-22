const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const DriverTracking = require("../models/DriverTracking");
const Chauffeur = require("../models/Chauffeur");
const Voyage = require("../models/Voyage");
const cookie = require("cookie");
const socketAuthMiddleware = require("../middleware/socketAuth.middleware");

const setupTrackingSocket = (io) => {
  console.log("🛰️ Tracking Socket setup started");
  
  // Réinitialiser tous les chauffeurs en 'offline' au démarrage du serveur
  // Cela évite les "chauffeurs fantômes" restés 'online' suite à un crash du serveur
  const resetDriversStatus = async () => {
    try {
      await DriverTracking.updateMany(
        { status: { $in: ["online", "delivering"] } },
        { status: "offline", socketId: null }
      );
      console.log("🧹 Initial tracking status cleanup completed");
    } catch (err) {
      console.error("❌ Error during tracking cleanup:", err.message);
    }
  };
  resetDriversStatus();
  
  // Nettoyage périodique des sessions inactives (Stale sessions)
  // S'exécute toutes les 2 minutes pour vérifier les chauffeurs qui n'ont pas envoyé de position depuis 3 mins
  setInterval(async () => {
    try {
      const staleTime = new Date(Date.now() - 3 * 60 * 1000); // 3 minutes
      
      const staleDrivers = await DriverTracking.find({
        status: { $in: ["online", "delivering"] },
        lastUpdate: { $lt: staleTime }
      });
      
      if (staleDrivers.length > 0) {
        console.log(`🧹 Cleaning up ${staleDrivers.length} stale tracking sessions`);
        
        for (const driver of staleDrivers) {
          await DriverTracking.findByIdAndUpdate(driver._id, { status: "offline" });
          
          // Notifier les superviseurs
          io.to("supervisors").emit("driverOffline", {
            chauffeurId: driver.chauffeurId
          });
        }
      }
    } catch (err) {
      console.error("❌ Error during periodic tracking cleanup:", err.message);
    }
  }, 2 * 60 * 1000); // Toutes les 2 minutes

  // Middleware d'authentification
  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role;

    console.log(`👤 New connection: ${userId} (${userRole}) - Socket ID: ${socket.id}`);

    // Rejoindre les rooms selon le rôle
    if (userRole === "chauffeur") {
      socket.join("drivers");
      
      // Trouver le document Chauffeur associé avec infos utilisateur
      const chauffeur = await Chauffeur.findOne({ utilisateur: userId }).populate("utilisateur", "username email");
      if (chauffeur) {
        socket.chauffeurId = chauffeur._id;
        
        // Récupérer le voyage en cours pour ce chauffeur
        const voyage = await Voyage.findOne({ chauffeur: chauffeur._id, statut: "EN_COURS" }).select("numero_voyage id_formate statut");

        // Mettre à jour le statut (en ligne ou en livraison)
        await DriverTracking.findOneAndUpdate(
          { chauffeurId: chauffeur._id },
          { 
            utilisateurId: userId,
            status: voyage ? "delivering" : "online",
            voyageId: voyage ? voyage._id : null,
            socketId: socket.id,
            lastUpdate: new Date()
          },
          { upsert: true, new: true }
        );
        console.log(`✅ Driver status updated for ${chauffeur._id} (${voyage ? "delivering" : "online"})`);

        // Notifier les superviseurs qu'un chauffeur est en ligne (avec son statut et voyage)
        io.to("supervisors").emit("driverOnline", {
          chauffeurId: {
            _id: chauffeur._id,
            utilisateur: chauffeur.utilisateur
          },
          utilisateurId: userId,
          status: voyage ? "delivering" : "online",
          voyageId: voyage ? { _id: voyage._id, id_formate: voyage.id_formate } : null
        });
      }
    } else if (userRole === "admin" || userRole === "responsableEntrepot") {
      socket.join("supervisors");
      console.log(`👀 Supervisor ${userId} (${userRole}) joined tracking room`);
      
      // Envoyer la liste initiale des chauffeurs actifs au nouveau superviseur
      try {
        const activeDrivers = await DriverTracking.find({
          status: { $in: ["online", "delivering"] }
        })
        .populate({
          path: "chauffeurId",
          populate: { path: "utilisateur", select: "username email" }
        })
        .populate({
          path: "voyageId",
          select: "numero_voyage id_formate statut"
        });
        
        console.log(`📊 Sending ${activeDrivers.length} active drivers to supervisor ${userId}`);
        socket.emit("initialDrivers", activeDrivers);
      } catch (err) {
        console.error("❌ Error sending initial drivers:", err);
      }
    }

    // Gestion de la mise à jour de localisation
    socket.on("driverLocationUpdate", async (data) => {
      if (userRole !== "chauffeur" || !socket.chauffeurId) return;

      const { lat, lng, voyageId, speed, heading } = data;
      const currentLocation = { lat, lng };

      try {
        const { getHaversineDistance, getRouteDeviation, isAtStop } = require("../services/eventEngine");

        // 1. Récupérer l'état de suivi précédent
        const prevTracking = await DriverTracking.findOne({ chauffeurId: socket.chauffeurId });
        
        let displacement = 0;
        let updateTrail = false;
        let newTrail = prevTracking ? [...(prevTracking.trail || [])] : [];

        if (prevTracking && prevTracking.currentLocation) {
          displacement = getHaversineDistance(
            currentLocation.lat,
            currentLocation.lng,
            prevTracking.currentLocation.lat,
            prevTracking.currentLocation.lng
          );
          
          // Déclencher une mise à jour de l'historique de trace si déplacement > 500m
          if (displacement >= 500) {
            updateTrail = true;
          }
        } else {
          updateTrail = true; // Premier point de trace
        }

        if (updateTrail) {
          newTrail.push({ lat, lng, timestamp: new Date() });
          // Conserver seulement les 20 derniers points pour limiter la taille de la BDD
          if (newTrail.length > 20) {
            newTrail.shift();
          }
        }

        // 2. Traitement d'événements liés au voyage actif
        let deviationDistance = 0;
        let isOffRoute = false;

        if (voyageId) {
          const activeVoyage = await Voyage.findById(voyageId);
          if (activeVoyage) {
            // A. Déviation (Hors itinéraire > 150m)
            if (activeVoyage.optimizedRoute && activeVoyage.optimizedRoute.polyline) {
              try {
                const polyline = require("@mapbox/polyline");
                const routePoints = polyline.decode(activeVoyage.optimizedRoute.polyline).map(coords => ({
                  lat: coords[0],
                  lng: coords[1]
                }));
                
                deviationDistance = getRouteDeviation(currentLocation, routePoints);
                if (deviationDistance > 150) {
                  isOffRoute = true;
                  
                  // Notifier immédiatement les superviseurs d'une déviation
                  io.to("supervisors").emit("deviationAlert", {
                    chauffeurId: socket.chauffeurId,
                    voyageId: activeVoyage._id,
                    id_formate: activeVoyage.id_formate,
                    deviationDistance: Math.round(deviationDistance),
                    timestamp: new Date()
                  });
                  
                  // Enregistrer l'événement dans le journal du voyage
                  await Voyage.findByIdAndUpdate(voyageId, {
                    $push: {
                      eventLog: {
                        type: "DEVIATION",
                        timestamp: new Date(),
                        description: `Déviation détectée de ${Math.round(deviationDistance)} mètres.`
                      }
                    }
                  });
                }
              } catch (err) {
                console.error("❌ Error parsing polyline for deviation:", err.message);
              }
            }

            // B. Geofencing d'Arrivée à une Livraison / un Arrêt
            if (activeVoyage.stops && activeVoyage.stops.length > 0) {
              // Trouver le prochain arrêt non livré/non arrivé
              const nextStop = activeVoyage.stops
                .sort((a, b) => a.ordre - b.ordre)
                .find(s => s.statut === "EN_ATTENTE");

              if (nextStop && nextStop.latitude && nextStop.longitude) {
                const reachedStop = isAtStop(currentLocation, {
                  lat: nextStop.latitude,
                  lng: nextStop.longitude
                });

                if (reachedStop) {
                  // Mettre à jour l'arrêt dans le voyage
                  await Voyage.updateOne(
                    { _id: voyageId, "stops._id": nextStop._id },
                    { 
                      $set: { 
                        "stops.$.statut": "ARRIVE",
                        "stops.$.actualArrival": new Date()
                      },
                      $push: {
                        eventLog: {
                          type: "STOP_ARRIVED",
                          timestamp: new Date(),
                          description: `Arrivée à l'arrêt: ${nextStop.nom || 'Client'}`
                        }
                      }
                    }
                  );

                  // Notifier les superviseurs de l'arrivée
                  io.to("supervisors").emit("arrivalEvent", {
                    chauffeurId: socket.chauffeurId,
                    voyageId: activeVoyage._id,
                    id_formate: activeVoyage.id_formate,
                    stopId: nextStop._id,
                    stopNom: nextStop.nom,
                    timestamp: new Date()
                  });
                }
              }
            }
          }
        }

        // 3. Persister la position actuelle dans DriverTracking
        const updateData = {
          currentLocation: currentLocation,
          lastUpdate: new Date(),
          status: voyageId ? "delivering" : "online",
          socketId: socket.id,
          speed: speed || 0,
          heading: heading || 0,
          trail: newTrail
        };
        if (voyageId) updateData.voyageId = voyageId;

        const tracking = await DriverTracking.findOneAndUpdate(
          { chauffeurId: socket.chauffeurId },
          updateData,
          { upsert: true, new: true }
        );

        // 4. Diffuser la position mise à jour aux superviseurs
        io.to("supervisors").emit("updateDriverLocation", {
          chauffeurId: socket.chauffeurId,
          location: currentLocation,
          voyageId: voyageId,
          speed: speed || 0,
          heading: heading || 0,
          isOffRoute: isOffRoute,
          deviationDistance: Math.round(deviationDistance),
          lastUpdate: tracking.lastUpdate
        });

      } catch (error) {
        console.error("❌ Error updating driver location:", error);
      }
    });

    // Déconnexion
    socket.on("disconnect", async () => {
      console.log(`🔌 User disconnected: ${userId}`);

      if (userRole === "chauffeur" && socket.chauffeurId) {
        // Marquer le chauffeur comme hors-ligne après un petit délai (pour gérer les micro-coupures)
        setTimeout(async () => {
          const currentTracking = await DriverTracking.findOne({ chauffeurId: socket.chauffeurId });
          
          // Ne marquer offline que si le socketId est toujours le même (évite d'écraser une nouvelle connexion)
          if (currentTracking && currentTracking.socketId === socket.id) {
            await DriverTracking.findOneAndUpdate(
              { chauffeurId: socket.chauffeurId },
              { status: "offline", lastUpdate: new Date() }
            );

            io.to("supervisors").emit("driverOffline", {
              chauffeurId: socket.chauffeurId
            });
            console.log(`🔴 Chauffeur ${socket.chauffeurId} marked offline`);
          }
        }, 10000); // 10 secondes de grâce
      }
    });
  });

  return io;
};

module.exports = setupTrackingSocket;
