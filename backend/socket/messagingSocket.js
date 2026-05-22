const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const Utilisateur = require('../models/Utilisateur');
const socketAuthMiddleware = require('../middleware/socketAuth.middleware');
const notificationController = require('../controllers/notification.controller');
const ollamaService = require('../services/ollamaService');
const mongoose = require('mongoose');

const setupMessagingSocket = (io) => {
  const messagingNamespace = io.of("/messaging");

  messagingNamespace.use(socketAuthMiddleware);

  messagingNamespace.on("connection", (socket) => {
    const userId = socket.user.id;
    const userRole = socket.user.role;
    console.log(`💬 User connected to messaging: ${userId} (${userRole})`);

    // Set online status for staff
    if (userRole !== 'client') {
      // 🚀 IMMEDIATE BROADCAST for instant feel
      messagingNamespace.to("staff").emit("user_status_changed", {
        userId: userId,
        isOnline: true,
        lastSeen: new Date()
      });

      Utilisateur.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() })
        .catch(err => console.error("Error updating online status:", err));
      
      socket.join("staff");
    }

    // Always join personal room for targeted notifications
    socket.join(`user_${userId}`);

    // Join a specific conversation room
    socket.on("join_conversation", (conversationId) => {
      socket.join(conversationId);
      console.log(`👤 User ${userId} joined conversation: ${conversationId}`);
    });

    // Leave a conversation room
    socket.on("leave_conversation", (conversationId) => {
      socket.leave(conversationId);
      console.log(`👤 User ${userId} left conversation: ${conversationId}`);
    });

    // Send a message
    socket.on("send_message", async (data) => {
      try {
        const { conversationId, content, type, mediaUrl, mediaName, mediaMimeType, mediaSize, mediaDuration } = data;
        
        const newMessage = new Message({
          conversationId,
          senderId: userId,
          senderModel: socket.user.userType === 'client' ? 'Client' : 'Utilisateur',
          senderName: socket.user.username,
          senderRole: socket.user.role,
          content,
          type,
          mediaUrl,
          mediaName,
          mediaMimeType,
          mediaSize,
          mediaDuration,
          readBy: [{ userId, userModel: socket.user.userType === 'client' ? 'Client' : 'Utilisateur' }]
        });

        await newMessage.save();

        // Update conversation last message and unread counts
        const conversation = await Conversation.findById(conversationId);
        conversation.lastMessage = {
          content: type === 'text' ? content : `[${type}]`,
          type,
          senderId: userId,
          createdAt: newMessage.createdAt
        };

        // Increment unread count for all participants except sender
        conversation.participants.forEach(p => {
          if (p.userId.toString() !== userId.toString()) {
            const currentCount = conversation.unreadCount.get(p.userId.toString()) || 0;
            conversation.unreadCount.set(p.userId.toString(), currentCount + 1);
          }
        });

        await conversation.save();

        // Trigger AI and notification logic
        const isSupport = conversation.type === 'support';
        const isClient = ['client', 'pdv'].includes(socket.user.userType) || ['client', 'pdv'].includes(socket.user.role);
        const isStaffSender = !isClient;

        // Broadcast message to everyone in the room
        messagingNamespace.to(conversationId).emit("new_message", newMessage);
        
        // Also notify participants outside the room (for badges and system notifications)
        conversation.participants.forEach(async (p) => {
          if (p.userId.toString() !== userId.toString()) {
            // SKIP notifications for support conversations when client/PDV sends a message
            // The AI handles these — staff only gets notified on [ESCALATE]
            if (isSupport && isClient) {
              return;
            }

            // Real-time toast/badge
            messagingNamespace.to(`user_${p.userId}`).emit("message_notification", {
              conversationId,
              message: newMessage
            });

            // Persist as system notification if recipient is a staff user
            if (p.userModel === 'Utilisateur') {
              await notificationController.createMessageNotification(p.userId, newMessage);
            }
          }
        });

        // Trigger AI response logic

        // CHECK: Human agent joining a support conversation → pause AI
        if (isSupport && isStaffSender) {
          const wasBot = conversation.metadata?.conversationMode !== 'human';
          
          await Conversation.findByIdAndUpdate(conversationId, {
            'metadata.conversationMode': 'human',
            'metadata.humanJoinedAt': conversation.metadata?.humanJoinedAt || new Date()
          });

          if (wasBot) {
            console.log(`🛑 [AI_PAUSE] Human agent ${userId} took over conv ${conversationId}`);
            messagingNamespace.to(conversationId).emit('agent_joined', {
              agentName: socket.user.username
            });
          }
        }
        
        console.log(`🧐 [AI_CHECK] ConvType: ${conversation.type}, UserType: ${socket.user.userType}, Role: ${socket.user.role}`);

        if (isSupport && isClient) {
          // Re-fetch to get latest mode
          const freshConv = await Conversation.findById(conversationId);
          const mode = freshConv.metadata?.conversationMode || 'bot';

          if (mode === 'human') {
            console.log(`🛑 [AI_SKIP] Conv ${conversationId} is in HUMAN mode — Sami stays silent`);
            return;
          }

          console.log(`🤖 [AI] Triggering AI response for conversation: ${conversationId} (User: ${userId})`);
          
          // Emit typing indicator
          messagingNamespace.to(conversationId).emit("ai_typing", { conversationId });

          try {
            // Call Ollama Streaming
            const stream = ollamaService.chatStream(
              conversationId, 
              content, 
              userId,
              conversation.metadata?.topic || 'Général'
            );

            let fullAiResponse = '';
            
            for await (const chunk of stream) {
              fullAiResponse += chunk;
              // Emit chunk to client
              messagingNamespace.to(conversationId).emit("ai_response_chunk", { 
                conversationId, 
                chunk 
              });
            }
            
            const needsEscalation = ollamaService.shouldEscalate(fullAiResponse);
            const cleanAiResponse = fullAiResponse.replace(/\[ESCALATE\]/gi, '').trim();

            if (!cleanAiResponse) {
              // Fallback if empty
              const fallback = "Comment puis-je vous aider ?";
              messagingNamespace.to(conversationId).emit("ai_response_chunk", { conversationId, chunk: fallback });
              fullAiResponse = fallback;
            }

            console.log(`🤖 [AI] AI finished responding: ${cleanAiResponse.substring(0, 50)}...`);

            // Save AI message to DB after stream ends
            const aiMessage = new Message({
              conversationId,
              senderId: new mongoose.Types.ObjectId('000000000000000000000001'),
              senderModel: 'AI',
              senderName: 'Assistant IA',
              senderRole: 'bot',
              content: cleanAiResponse,
              type: 'text',
              readBy: []
            });

            await aiMessage.save();

            // Emit final message object to sync state
            messagingNamespace.to(conversationId).emit("ai_response_complete", { 
              conversationId, 
              message: aiMessage 
            });

            // Update conversation last message
            conversation.lastMessage = {
              content: cleanAiResponse,
              type: 'text',
              senderId: aiMessage.senderId,
              createdAt: aiMessage.createdAt
            };
            await conversation.save();

            // CHECK FOR ESCALATION
            if (needsEscalation) {
              console.log(`🚩 [ESCALATE] Escalation triggered for conversation: ${conversationId}`);
              
              messagingNamespace.to("staff").emit("escalation_needed", { 
                conversationId, 
                topic: conversation.metadata?.topic,
                assignedTo: conversation.metadata?.assignedTo 
              });

              const senderType = (socket.user.userType || socket.user.role || '').toLowerCase();
              const userLabel = senderType === 'pdv' ? 'PDV' : 'client';
              const escalationTitle = "🚩 Aide requise";
              const escalationMessage = `Un ${userLabel} a besoin d'assistance sur le sujet: ${conversation.metadata?.topic}`;
              const escalationData = { conversationId: conversationId.toString() };

              try {
                await notificationController.notifyAllResponsables('NEW_MESSAGE', escalationTitle, escalationMessage, escalationData);
                await notificationController.notifyAllAdmins('NEW_MESSAGE', escalationTitle, escalationMessage, escalationData);
                messagingNamespace.to("staff").emit('new_notification', { type: 'NEW_MESSAGE', title: escalationTitle });
              } catch (dbErr) {
                console.error(`❌ [ESCALATE] Failed to save DB notifications:`, dbErr);
              }
            }
          } catch (aiErr) {
            console.error("❌ [AI] Error during AI response generation:", aiErr);
          } finally {
            messagingNamespace.to(conversationId).emit("ai_stop_typing", { conversationId });
          }
        }

      } catch (error) {
        console.error("❌ Error sending message:", error);
        socket.emit("error", { message: "Erreur lors de l'envoi du message" });
      }
    });

    // Typing indicator
    socket.on("typing", (data) => {
      const { conversationId, username } = data;
      socket.to(conversationId).emit("user_typing", { conversationId, username });
    });

    socket.on("stop_typing", (data) => {
      const { conversationId } = data;
      socket.to(conversationId).emit("user_stop_typing", { conversationId });
    });

    // Return to bot mode
    socket.on("return_to_bot", async ({ conversationId }) => {
      try {
        await Conversation.findByIdAndUpdate(conversationId, {
          'metadata.conversationMode': 'bot',
          'metadata.escalatedAt': null // Clear escalation flag
        });
        console.log(`✅ [AI_RESUME] Agent ${userId} returned conv ${conversationId} to bot mode`);
        
        // Notify the conversation room
        messagingNamespace.to(conversationId).emit('agent_left', {
          agentName: socket.user.username
        });
        
        // Notify clients to refresh the mode UI
        messagingNamespace.to(conversationId).emit('mode_changed', {
          conversationId,
          mode: 'bot'
        });
      } catch (err) {
        console.error("❌ Error returning to bot:", err);
      }
    });

    // User-specific room for notifications
    socket.join(`user_${userId}`);

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected from messaging: ${userId}`);
      if (userRole !== 'client') {
        const lastSeen = new Date();
        // 🚀 IMMEDIATE BROADCAST for instant feel
        messagingNamespace.to("staff").emit("user_status_changed", {
          userId: userId,
          isOnline: false,
          lastSeen: lastSeen
        });

        Utilisateur.findByIdAndUpdate(userId, { isOnline: false, lastSeen: lastSeen })
          .catch(err => console.error("Error updating offline status:", err));
      }
    });
  });
};

module.exports = setupMessagingSocket;
