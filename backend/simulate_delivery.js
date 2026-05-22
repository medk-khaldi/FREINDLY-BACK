const mongoose = require('mongoose');

// Connection options
mongoose.connect('mongodb+srv://louay_benali:rDmBFugpa3efXYH7@cluster0.tk1av5b.mongodb.net/Projet_pfe')
  .then(async () => {
    console.log('🔌 Connected to MongoDB for Chauffeur Simulation\n');
    
    const VoyageSchema = new mongoose.Schema({}, { strict: false });
    const Voyage = mongoose.model('Voyage', VoyageSchema, 'voyages');
    
    // 1. Fetch Voyage 248
    let voyage = await Voyage.findOne({ numero_voyage: 248 });
    if (!voyage) {
      console.error('❌ Voyage 248 not found in DB!');
      process.exit(1);
    }
    
    console.log(`📍 Found Voyage VOY-0248 (Statut: ${voyage.get('statut')})`);

    // Reset all stops to EN_ATTENTE at the beginning of the script so it always starts fresh with Stop 1 (Ariana)
    console.log('🧹 Force resetting all stops to EN_ATTENTE for simulation stability...');
    const initialStops = (voyage.get('stops') || []).map(s => {
      // If s is a Mongoose subdocument, convert to object or mutate directly
      const stopObj = s.toObject ? s.toObject() : s;
      return {
        ...stopObj,
        statut: 'EN_ATTENTE',
        actualArrival: null
      };
    });
    await Voyage.updateOne(
      { _id: voyage._id },
      { $set: { stops: initialStops } }
    );
    voyage = await Voyage.findById(voyage._id);
    
    // 2. Set Voyage to EN_COURS for active delivery tracking
    console.log('🔄 Changing Voyage status to "EN_COURS" for simulation...');
    voyage.set('statut', 'EN_COURS');
    await voyage.save();
    
    // 3. Find the next pending stop (Stop 1: majdi amdouni)
    const stops = voyage.get('stops') || [];
    const nextStop = [...stops].sort((a, b) => a.ordre - b.ordre).find(s => s.statut === 'EN_ATTENTE');
    
    if (!nextStop) {
      console.log('❌ No pending stops found even after reset!');
      process.exit(1);
    }
    
    console.log(`\n🎯 Next Stop to Reach: ${nextStop.nom} (Ariana)`);
    console.log(`   Target Coordinates: ${nextStop.latitude}, ${nextStop.longitude}\n`);
    
    // 4. Import geofencing engine logic
    const { getHaversineDistance, isAtStop } = require('./services/eventEngine');
    const { getDepotCentral } = require('./utils/depotUtils');
    
    // Make sure GlobalConfig model is registered
    require('./models/GlobalConfig');
    const depot = await getDepotCentral();
    
    // Coordinates path representing chauffeur driving from Depot -> Manzah 6 -> Ariana Stop
    const simulatedPath = [
      { name: `${depot.nom} (Départ)`, lat: depot.latitude, lng: depot.longitude },
      { name: "Passage par El Manzah 6", lat: 36.84659, lng: 10.166468 },
      { name: "Entrée d'Ariana (Approche)", lat: 36.8660, lng: 10.2210 },
      { name: "Arrivée devant l'adresse client", lat: 36.866654, lng: 10.221624 }
    ];
    
    // 5. Run the GPS movement loop
    for (let i = 0; i < simulatedPath.length; i++) {
      const currentLoc = simulatedPath[i];
      const distance = getHaversineDistance(currentLoc.lat, currentLoc.lng, nextStop.latitude, nextStop.longitude);
      const isReached = isAtStop({ lat: currentLoc.lat, lng: currentLoc.lng }, { lat: nextStop.latitude, lng: nextStop.longitude }, 150); // Using 150m threshold for simulation
      
      console.log(`🚗 Chauffeur Position ${i + 1}: ${currentLoc.name}`);
      console.log(`   Coords: ${currentLoc.lat}, ${currentLoc.lng}`);
      console.log(`   Distance to Target: ${distance.toFixed(1)} meters`);
      
      if (isReached) {
        console.log(`\n🎉 [GEOFENCE TRIGGERED] Chauffeur reached the stop within the threshold!`);
        console.log(`💾 Updating Database stop to "ARRIVE" and logging actualArrival...`);
        
        // Update DB
        await Voyage.updateOne(
          { _id: voyage._id, "stops._id": nextStop._id },
          { 
            $set: { 
              "stops.$.statut": "ARRIVE",
              "stops.$.actualArrival": new Date()
            }
          }
        );
        
        console.log(`✅ Stop marked as ARRIVE successfully!`);
        break;
      } else {
        console.log(`❌ Not arrived yet (Threshold is 150m)\n`);
      }
      
      // Artificial delay between steps
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    // 6. Print final state
    const updatedVoyage = await Voyage.findById(voyage._id);
    const updatedStop = updatedVoyage.get('stops').find(s => s._id.toString() === nextStop._id.toString());
    console.log('\n--- VERIFICATION STATE IN MONGO ---');
    console.log(`Stop Name: ${updatedStop.nom}`);
    console.log(`Stop Status: ${updatedStop.statut}`);
    console.log(`Actual Arrival: ${updatedStop.actualArrival}`);
    console.log('------------------------------------\n');
    
    // Reset back to EN_ATTENTE and EN_ATTENTE for future tests
    console.log('🔄 Cleaning up: Resetting Voyage and Stop status back to initial state...');
    await Voyage.updateOne(
      { _id: voyage._id, "stops._id": nextStop._id },
      { 
        $set: { 
          "stops.$.statut": "EN_ATTENTE",
          "stops.$.actualArrival": null
        }
      }
    );
    voyage.set('statut', 'EN_ATTENTE');
    await voyage.save();
    console.log('🧹 Cleaned up successfully. Ready for next simulation!');
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Connection error:', err);
    process.exit(1);
  });
