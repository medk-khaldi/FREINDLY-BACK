/**
 * Email templates for the Marketplace platform
 */

const primaryColor = '#4c6ef5';
const secondaryColor = '#22b8cf';
const darkColor = '#212529';
const lightColor = '#f8f9fa';

const headerStyle = `
  background-color: ${primaryColor};
  color: white;
  padding: 30px;
  text-align: center;
  border-radius: 8px 8px 0 0;
`;

const containerStyle = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  color: ${darkColor};
  line-height: 1.6;
`;

const contentStyle = `
  padding: 30px;
  background-color: white;
`;

const footerStyle = `
  padding: 20px;
  text-align: center;
  font-size: 12px;
  color: #6c757d;
  background-color: ${lightColor};
  border-radius: 0 0 8px 8px;
`;

const buttonStyle = `
  display: inline-block;
  padding: 12px 24px;
  background-color: ${primaryColor};
  color: white;
  text-decoration: none;
  border-radius: 4px;
  font-weight: bold;
  margin-top: 20px;
`;

/**
 * Order Confirmation Template
 */
exports.orderConfirmationTemplate = (commande, client) => {
  const itemsHtml = (commande.lignesCommande || []).map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">
        ${item.produit?.nom || 'Produit'} ${item.selectedLot ? `(Lot: ${item.selectedLot.numero_lot})` : ''}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">
        x${item.quantite}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">
        ${item.prix_unitaire?.toFixed(2)} TND
      </td>
    </tr>
  `).join('');

  return `
    <div style="${containerStyle}">
      <div style="${headerStyle}">
        <h1 style="margin: 0;">Merci pour votre commande !</h1>
        <p style="margin: 10px 0 0;">Commande #${commande.id_formate || commande._id}</p>
      </div>
      <div style="${contentStyle}">
        <p>Bonjour ${client.prenom} ${client.nom},</p>
        <p>Nous avons bien reçu votre commande et nous commençons à la préparer.</p>
        
        <h3 style="border-bottom: 2px solid ${primaryColor}; padding-bottom: 10px; margin-top: 30px;">Résumé de la commande</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background-color: ${lightColor};">
              <th style="padding: 10px; text-align: left;">Produit</th>
              <th style="padding: 10px; text-align: center;">Qté</th>
              <th style="padding: 10px; text-align: right;">Prix</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding: 10px; text-align: right; font-weight: bold;">Total</td>
              <td style="padding: 10px; text-align: right; font-weight: bold; color: ${primaryColor};">${commande.total?.toFixed(2)} TND</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top: 30px; padding: 20px; background-color: #e7f5ff; border-radius: 8px;">
          <h4 style="margin-top: 0;">Adresse de livraison</h4>
          <p style="margin-bottom: 0;">
            ${commande.adresse_livraison?.rue || ''}<br>
            ${commande.adresse_livraison?.localite || ''}, ${commande.adresse_livraison?.delegation || ''}<br>
            ${commande.adresse_livraison?.gouvernorat || ''} ${commande.adresse_livraison?.codePostal || ''}
          </p>
        </div>

        <div style="text-align: center;">
          <a href="http://localhost:3000/profile" style="${buttonStyle}">Suivre ma commande</a>
        </div>
      </div>
      <div style="${footerStyle}">
        <p>&copy; 2026 Marketplace Platform. Tous droits réservés.</p>
        <p>Vous recevez cet email car vous avez passé une commande sur notre plateforme.</p>
      </div>
    </div>
  `;
};

/**
 * Status Update Template
 */
exports.statusUpdateTemplate = (commande, client, oldStatus, newStatus) => {
  let statusMessage = "";
  let statusColor = primaryColor;

  switch(newStatus) {
    case 'PREPAREE':
      statusMessage = "Votre commande est maintenant préparée et prête pour l'expédition.";
      break;
    case 'EN_LIVRAISON':
      statusMessage = "Bonne nouvelle ! Votre commande est en cours de livraison.";
      statusColor = secondaryColor;
      break;
    case 'LIVREE':
      statusMessage = "Votre commande a été livrée avec succès. Merci de confirmer la réception sur votre profil.";
      statusColor = "#40c057";
      break;
    case 'ANNULEE':
      statusMessage = "Votre commande a été annulée.";
      statusColor = "#fa5252";
      break;
    default:
      statusMessage = `Le statut de votre commande a été mis à jour vers : ${newStatus}`;
  }

  return `
    <div style="${containerStyle}">
      <div style="${headerStyle}; background-color: ${statusColor};">
        <h1 style="margin: 0;">Mise à jour de votre commande</h1>
        <p style="margin: 10px 0 0;">Commande #${commande.id_formate || commande._id}</p>
      </div>
      <div style="${contentStyle}">
        <p>Bonjour ${client.prenom} ${client.nom},</p>
        <p style="font-size: 18px; font-weight: bold; color: ${statusColor};">${statusMessage}</p>
        
        <div style="margin: 40px 0; text-align: center;">
          <div style="display: flex; justify-content: space-between; align-items: center; max-width: 400px; margin: 0 auto;">
            <div style="text-align: center;">
              <div style="width: 30px; height: 30px; border-radius: 50%; background-color: #40c057; color: white; line-height: 30px; margin: 0 auto;">✓</div>
              <div style="font-size: 10px; margin-top: 5px;">En attente</div>
            </div>
            <div style="flex: 1; height: 2px; background-color: ${['PREPAREE', 'EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '#40c057' : '#dee2e6'}; margin: 0 5px; margin-bottom: 15px;"></div>
            <div style="text-align: center;">
              <div style="width: 30px; height: 30px; border-radius: 50%; background-color: ${['PREPAREE', 'EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '#40c057' : (newStatus === 'EN_ATTENTE' ? primaryColor : '#dee2e6')}; color: white; line-height: 30px; margin: 0 auto;">${['PREPAREE', 'EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '✓' : '2'}</div>
              <div style="font-size: 10px; margin-top: 5px;">Préparée</div>
            </div>
            <div style="flex: 1; height: 2px; background-color: ${['EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '#40c057' : '#dee2e6'}; margin: 0 5px; margin-bottom: 15px;"></div>
            <div style="text-align: center;">
              <div style="width: 30px; height: 30px; border-radius: 50%; background-color: ${['EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '#40c057' : (newStatus === 'PREPAREE' ? primaryColor : '#dee2e6')}; color: white; line-height: 30px; margin: 0 auto;">${['EN_LIVRAISON', 'LIVREE'].includes(newStatus) ? '✓' : '3'}</div>
              <div style="font-size: 10px; margin-top: 5px;">En livraison</div>
            </div>
            <div style="flex: 1; height: 2px; background-color: ${newStatus === 'LIVREE' ? '#40c057' : '#dee2e6'}; margin: 0 5px; margin-bottom: 15px;"></div>
            <div style="text-align: center;">
              <div style="width: 30px; height: 30px; border-radius: 50%; background-color: ${newStatus === 'LIVREE' ? '#40c057' : (newStatus === 'EN_LIVRAISON' ? primaryColor : '#dee2e6')}; color: white; line-height: 30px; margin: 0 auto;">${newStatus === 'LIVREE' ? '✓' : '4'}</div>
              <div style="font-size: 10px; margin-top: 5px;">Livrée</div>
            </div>
          </div>
        </div>

        <div style="text-align: center;">
          <a href="http://localhost:3000/profile" style="${buttonStyle}">Détails de la commande</a>
        </div>
      </div>
      <div style="${footerStyle}">
        <p>&copy; 2026 Marketplace Platform. Tous droits réservés.</p>
      </div>
    </div>
  `;
};
