const nodemailer = require('nodemailer');
const { orderConfirmationTemplate, statusUpdateTemplate } = require('./emailTemplates');

/**
 * Service d'envoi d'emails
 * Ne bloque jamais l'application — si la config est manquante, les emails sont silencieusement ignorés.
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.configured = false;

    const password = process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASSWORD;
    
    // Ne pas créer le transporter si le mot de passe est un placeholder ou absent
    if (!password || password === 'votre_mot_de_passe_application_ici') {
      console.warn('⚠️  Email: Mot de passe non configuré dans .env → les notifications email sont désactivées.');
      console.warn('   Pour activer: ajoutez EMAIL_APP_PASSWORD dans backend/.env');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.EMAIL_PORT) || 587,
        secure: parseInt(process.env.EMAIL_PORT) === 465,
        auth: {
          user: process.env.EMAIL_USER || 'islemmnari21@gmail.com',
          pass: password
        }
      });
      this.configured = true;
      console.log('📧 Email: Service configuré avec succès (' + (process.env.EMAIL_USER || 'islemmnari21@gmail.com') + ')');
    } catch (error) {
      console.warn('⚠️  Email: Erreur de configuration, notifications désactivées:', error.message);
    }
  }

  /**
   * Envoyer un email de confirmation de commande
   */
  async sendOrderConfirmation(commande, client) {
    if (!this.configured || !this.transporter) {
      console.log('📧 Email de confirmation non envoyé (service non configuré)');
      return false;
    }

    try {
      if (!client?.email) {
        console.warn(`⚠️ Pas d'email pour le client ${client?._id}, annulation de l'envoi.`);
        return false;
      }

      const html = orderConfirmationTemplate(commande, client);
      
      const info = await this.transporter.sendMail({
        from: `"Marketplace Platform" <${process.env.EMAIL_USER || 'islemmnari21@gmail.com'}>`,
        to: client.email,
        subject: `Confirmation de votre commande #${commande.id_formate || commande._id}`,
        html: html
      });

      console.log(`📧 Email de confirmation envoyé à ${client.email}: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur envoi email confirmation:`, error.message);
      return false;
    }
  }

  /**
   * Envoyer une mise à jour de statut de commande
   */
  async sendStatusUpdate(commande, client, oldStatus, newStatus) {
    if (!this.configured || !this.transporter) {
      console.log(`📧 Email statut (${oldStatus} → ${newStatus}) non envoyé (service non configuré)`);
      return false;
    }

    try {
      if (!client?.email) {
        console.warn(`⚠️ Pas d'email pour le client ${client?._id}, annulation de l'envoi.`);
        return false;
      }

      const html = statusUpdateTemplate(commande, client, oldStatus, newStatus);
      
      const info = await this.transporter.sendMail({
        from: `"Marketplace Platform" <${process.env.EMAIL_USER || 'islemmnari21@gmail.com'}>`,
        to: client.email,
        subject: `Mise à jour de votre commande #${commande.id_formate || commande._id}`,
        html: html
      });

      console.log(`📧 Email mise à jour statut envoyé à ${client.email}: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`❌ Erreur envoi email statut:`, error.message);
      return false;
    }
  }
}

module.exports = new EmailService();
