const nodemailer = require('nodemailer');

// Configuration du transporteur email via BREVO (vérifications & codes)
let transporter = null;

const brevoPass = process.env.BREVO_PASS;
if (brevoPass && brevoPass !== 'YOUR_BREVO_API_KEY') {
  transporter = nodemailer.createTransport({
    host: process.env.BREVO_HOST || 'smtp-relay.sendinblue.com',
    port: parseInt(process.env.BREVO_PORT) || 587,
    secure: false, // STARTTLS
    auth: {
      user: process.env.BREVO_USER || 'apikey',
      pass: brevoPass
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  // Vérifier la connexion au démarrage
  transporter.verify(function(error, success) {
    if (error) {
      console.warn('⚠️  Email (utils/Brevo): Connexion SMTP échouée:', error.message);
    } else {
      console.log('✅ Serveur email (utils/Brevo) prêt à envoyer des messages');
    }
  });
} else {
  console.warn('⚠️  Email (utils): BREVO_PASS non configuré → vérification/reset par email désactivés');
}


// Générer un code de vérification à 6 chiffres
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Envoyer un email de vérification
const sendVerificationEmail = async (email, username, code) => {
  // Utiliser l'email vérifié sur Brevo comme expéditeur
  const senderEmail = 'louay.benali3772@gmail.com'; // Votre email vérifié sur Brevo
  
  const mailOptions = {
    from: `"Plateforme Entrepôt" <${senderEmail}>`,
    to: email, // L'email de l'utilisateur qui s'inscrit
    subject: 'Vérification de votre compte',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3b82f6;">Bienvenue ${username}!</h2>
        <p>Merci de vous être inscrit sur notre plateforme.</p>
        <p>Votre code de vérification est:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1f2937; border-radius: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p>Ce code expire dans 15 minutes.</p>
        <p style="color: #6b7280; font-size: 14px;">Si vous n'avez pas créé de compte, ignorez cet email.</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email de vérification envoyé à:', email);
    console.log('📧 Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi email à', email);
    console.error('Détails:', error.message);
    if (error.response) {
      console.error('Réponse serveur:', error.response);
    }
    return false;
  }
};

// Envoyer un email de réinitialisation de mot de passe
const sendPasswordResetEmail = async (email, username, code) => {
  // Utiliser l'email vérifié sur Brevo comme expéditeur
  const senderEmail = 'louay.benali3772@gmail.com'; // Votre email vérifié sur Brevo
  
  const mailOptions = {
    from: `"Plateforme Entrepôt" <${senderEmail}>`,
    to: email,
    subject: 'Réinitialisation de votre mot de passe',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #3b82f6;">Bonjour ${username},</h2>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
        <p>Votre code de réinitialisation est:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #1f2937; border-radius: 8px; margin: 20px 0;">
          ${code}
        </div>
        <p>Ce code expire dans 15 minutes.</p>
        <p style="color: #6b7280; font-size: 14px;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email de réinitialisation envoyé à:', email);
    console.log('📧 Message ID:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Erreur envoi email à', email);
    console.error('Détails:', error.message);
    if (error.response) {
      console.error('Réponse serveur:', error.response);
    }
    return false;
  }
};

module.exports = {
  generateVerificationCode,
  sendVerificationEmail,
  sendPasswordResetEmail
};
