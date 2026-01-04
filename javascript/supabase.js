// /javascript/supabase.js
// Supabase helpers for BlackNote - Complete Firebase Migration

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/* -----------------------
   SUPABASE CONFIG
   ----------------------- */
const supabaseUrl = 'https://dytfyrtiowvrevqjbghn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5dGZ5cnRpb3d2cmV2cWpiZ2huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODU4OTEsImV4cCI6MjA4Mjg2MTg5MX0.h9CH4Rup-31mV5JOVL5NMXzrM5u0Q_UGO9St66yBJIg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/* -----------------------
   NOTIFICATION SOUND SYSTEM
   ----------------------- */
let notificationAudio = null;
let lastMessageCount = {};
let notificationsEnabled = true;
let globalChatSubscription = null;

// Initialize notification sound
function initNotificationSound() {
  if (!notificationAudio) {
    notificationAudio = new Audio('/assets/not1.mp3');
    notificationAudio.volume = 0.5;
  }
}

// Play notification sound
function playNotificationSound() {
  if (!notificationsEnabled) return;
  
  try {
    initNotificationSound();
    notificationAudio.currentTime = 0;
    notificationAudio.play().catch(err => {
      console.log('Could not play notification sound:', err);
    });
  } catch (err) {
    console.warn('Notification sound error:', err);
  }
}

// Enable/disable notifications
function setNotificationsEnabled(enabled) {
  notificationsEnabled = enabled;
}

// Set custom notification sound
function setNotificationSound(soundUrl, volume = 0.5) {
  try {
    notificationAudio = new Audio(soundUrl);
    notificationAudio.volume = volume;
  } catch (err) {
    console.error('Failed to set notification sound:', err);
  }
}

/* -----------------------
   GLOBAL NOTIFICATION LISTENER
   ----------------------- */
async function startGlobalNotifications(userId) {
  if (!userId) {
    console.warn('Cannot start global notifications: no user ID');
    return;
  }
  
  // Stop existing listener if any
  if (globalChatSubscription) {
    globalChatSubscription.unsubscribe();
    globalChatSubscription = null;
  }
  
  // Get initial state for all user's chats
  try {
    const { data: chats, error } = await supabase
      .from('chats')
      .select('id, last_message_time')
      .contains('participants', [userId]);
    
    if (error) throw error;
    
    chats?.forEach((chat) => {
      if (chat.last_message_time) {
        const lastMsgKey = `global_${chat.id}`;
        lastMessageCount[lastMsgKey] = new Date(chat.last_message_time).getTime();
      }
    });
    console.log('✅ Global notifications initialized for user:', userId);
  } catch (err) {
    console.error('Error initializing global notifications:', err);
  }
  
  // Subscribe to chat updates
  globalChatSubscription = supabase
    .channel('global-chats')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chats',
        filter: `participants.cs.{${userId}}`
      },
      async (payload) => {
        const chatData = payload.new;
        const chatId = chatData.id;
        
        if (chatData.last_message_time) {
          const lastMsgKey = `global_${chatId}`;
          const storedTime = lastMessageCount[lastMsgKey];
          const newTime = new Date(chatData.last_message_time).getTime();
          
          if (storedTime && newTime > storedTime) {
            await checkAndPlayNotification(chatId, userId);
            lastMessageCount[lastMsgKey] = newTime;
          } else if (!storedTime) {
            lastMessageCount[lastMsgKey] = newTime;
          }
        }
      }
    )
    .subscribe();
}

async function checkAndPlayNotification(chatId, currentUserId) {
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('timestamp', { ascending: false })
      .limit(1);
    
    if (error) throw error;
    
    if (messages && messages.length > 0) {
      const lastMsg = messages[0];
      
      if (lastMsg.sender !== currentUserId) {
        playNotificationSound();
        console.log('🔔 Notification played for chat:', chatId);
      }
    }
  } catch (err) {
    console.error('Error checking notification:', err);
  }
}

function stopGlobalNotifications() {
  if (globalChatSubscription) {
    globalChatSubscription.unsubscribe();
    globalChatSubscription = null;
    console.log('🔇 Global notifications stopped');
  }
}

/* -----------------------
   Auth helpers
   ----------------------- */
async function signup(email, password, displayName) {
  console.log('🔄 Starting signup for:', email);
  
  // Sign up the user without email confirmation
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || ''
      }
    }
  });

  if (authError) {
    console.error('❌ Signup auth error:', authError);
    throw authError;
  }
  
  const user = authData.user;
  if (!user) {
    console.error('❌ No user returned from signup');
    throw new Error('Signup failed - no user data');
  }

  console.log('✅ User created:', {
    id: user.id,
    email: user.email
  });

  // Check if email already exists
  if (user.identities && user.identities.length === 0) {
    console.warn('⚠️ Email already registered');
    throw new Error('This email is already registered. Please login instead.');
  }

  // Profile will be created automatically by database trigger
  console.log('✅ Signup complete');
  
  return user;
}

async function login(email, password) {
  console.log('🔄 Attempting login for:', email);
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error('❌ Login error:', error);
    throw error;
  }
  
  console.log('✅ Login successful');
  return data;
}

async function logout() {
  console.log('🔄 Logging out...');
  stopGlobalNotifications();
  
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error('❌ Logout error:', error);
    throw error;
  }
  
  console.log('✅ Logged out successfully');
}

async function resetPassword(email) {
  if (!email) throw new Error("Email is required");
  
  console.log('🔄 Sending password reset to:', email);
  
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/pages/reset-password.html`
  });
  
  if (error) {
    console.error('❌ Password reset error:', error);
    throw error;
  }
  
  console.log('✅ Password reset email sent');
  return true;
}

/* -----------------------
   Auth state listener
   ----------------------- */
function onAuthStateChanged(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    console.log('🔄 Auth state changed:', event, session?.user?.id || 'no user');
    callback(session?.user || null);
  });
}

/* -----------------------
   Storage helper (image upload)
   ----------------------- */
async function uploadImageForUser(file, uid) {
  if (!file) throw new Error("No file provided");
  if (!uid) throw new Error("Missing user id");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("File too large (max 10 MB)");

  const filenameSafe = file.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  const path = `user_images/${uid}/${Date.now()}_${filenameSafe}`;

  const { data, error } = await supabase.storage
    .from('user-images')
    .upload(path, file);

  if (error) throw error;

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('user-images')
    .getPublicUrl(path);

  return publicUrl;
}

/* -----------------------
   Messaging helpers - WITH NOTIFICATION
   ----------------------- */
async function sendMessageToChat(chatId, senderUid, text = "", imageUrl = null) {
  if (!chatId) throw new Error("Missing chatId");
  if (!senderUid) throw new Error("Missing senderUid");
  
  // Check if chat exists
  const { data: chatExists } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .single();
  
  if (!chatExists) {
    console.log("Chat doesn't exist, creating it...");
    let participants = [];
    if (chatId.startsWith('dm_')) {
      participants = chatId.replace('dm_', '').split('_');
    } else {
      participants = [senderUid];
    }
    
    await supabase.from('chats').insert({
      id: chatId,
      type: chatId.startsWith('dm_') ? 'dm' : 'group',
      participants: participants,
      created_at: new Date().toISOString(),
      last_message: null,
      last_message_time: null
    });
  }
  
  // Insert message
  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      sender: senderUid,
      text: text || null,
      image_url: imageUrl || null,
      timestamp: new Date().toISOString()
    });
  
  if (msgError) throw msgError;
  
  // Update chat's last message
  const { error: updateError } = await supabase
    .from('chats')
    .update({
      last_message: text || "Photo",
      last_message_time: new Date().toISOString()
    })
    .eq('id', chatId);
  
  if (updateError) throw updateError;
}

function subscribeToChat(chatId, cbOnUpdate, cbOnError) {
  // Initialize message count
  if (lastMessageCount[chatId] === undefined) {
    lastMessageCount[chatId] = null;
  }
  
  // Get initial messages
  supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('timestamp', { ascending: true })
    .then(({ data, error }) => {
      if (error) {
        if (typeof cbOnError === 'function') cbOnError(error);
        return;
      }
      
      lastMessageCount[chatId] = data?.length || 0;
      cbOnUpdate(data || []);
    });
  
  // Subscribe to new messages
  const subscription = supabase
    .channel(`chat-${chatId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `chat_id=eq.${chatId}`
      },
      async (payload) => {
        // Fetch all messages again
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('timestamp', { ascending: true });
        
        if (error) {
          if (typeof cbOnError === 'function') cbOnError(error);
          return;
        }
        
        const msgs = data || [];
        
        // Check if sound should play
        const { data: { user } } = await supabase.auth.getUser();
        if (user && msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          
          if (lastMessageCount[chatId] !== null && 
              msgs.length > lastMessageCount[chatId] && 
              lastMsg.sender !== user.id) {
            playNotificationSound();
          }
          
          lastMessageCount[chatId] = msgs.length;
        }
        
        cbOnUpdate(msgs);
      }
    )
    .subscribe();
  
  // Return unsubscribe function
  return () => subscription.unsubscribe();
}

/* -----------------------
   Chat management
   ----------------------- */
async function ensureChatExists(chatId, participants, chatType = 'dm', groupName = null) {
  if (!chatId) throw new Error("Missing chatId");
  
  const { data: existingChat } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .single();
  
  if (!existingChat) {
    const chatData = {
      id: chatId,
      type: chatType,
      participants: participants,
      created_at: new Date().toISOString(),
      last_message: null,
      last_message_time: null
    };
    
    if (chatType === 'group' && groupName) {
      chatData.name = groupName;
    }
    
    const { error } = await supabase.from('chats').insert(chatData);
    if (error) throw error;
    
    console.log('✅ Chat created:', chatId);
  }
  
  return chatId;
}

/* -----------------------
   User Profile helpers
   ----------------------- */
async function getUserProfile(uid) {
  if (!uid) throw new Error("Missing user id");
  
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('uid', uid)
    .single();
  
  if (error) throw error;
  if (!data) throw new Error("User not found");
  
  return data;
}

async function getUserFriendsList(uid) {
  if (!uid) throw new Error("Missing user id");
  
  const { data, error } = await supabase
    .from('users')
    .select('friends')
    .eq('uid', uid)
    .single();
  
  if (error) return [];
  
  return data?.friends || [];
}

/* -----------------------
   Update user profile
   ----------------------- */
async function updateUserProfile({ displayName, bio, pfpUrl, username }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const updates = {};
  if (displayName !== undefined) updates.name = displayName;
  if (bio !== undefined) updates.bio = bio;
  if (pfpUrl !== undefined) updates.pfp = pfpUrl;
  if (username !== undefined) {
    updates.username = username;
    updates.last_username_change = new Date().toISOString();
  }

  if (Object.keys(updates).length) {
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('uid', user.id);
    
    if (error) throw error;
  }

  // Update auth metadata
  const authUpdates = {};
  if (displayName !== undefined) {
    authUpdates.data = { display_name: displayName };
  }
  
  if (Object.keys(authUpdates).length) {
    const { error } = await supabase.auth.updateUser(authUpdates);
    if (error) console.warn("updateUser metadata failed:", error);
  }

  return true;
}

/* -----------------------
   Storage cleanup
   ----------------------- */
async function deleteUserStorageFolder(uid) {
  if (!uid) throw new Error("Missing user id");
  
  const { data: files, error: listError } = await supabase.storage
    .from('user-images')
    .list(`user_images/${uid}`);
  
  if (listError) throw listError;
  
  if (files && files.length > 0) {
    const filePaths = files.map(file => `user_images/${uid}/${file.name}`);
    const { error: deleteError } = await supabase.storage
      .from('user-images')
      .remove(filePaths);
    
    if (deleteError) throw deleteError;
  }
  
  return true;
}

/* -----------------------
   Delete account
   ----------------------- */
async function deleteCurrentUserAccount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const uid = user.id;

  try {
    await supabase.from('users').delete().eq('uid', uid);
  } catch (err) {
    console.warn("Failed to delete user doc (continuing):", err);
  }

  try {
    await deleteUserStorageFolder(uid);
  } catch (err) {
    console.warn("Failed to delete user storage folder (continuing):", err);
  }

  // Delete auth user (requires admin API or RPC function)
  // This should be handled by a server-side function for security
  const { error } = await supabase.rpc('delete_user');
  if (error) {
    console.error("Failed to delete auth user:", error);
    throw error;
  }

  return true;
}

/* -----------------------
   Subscribe to collection
   ----------------------- */
function subscribeToCollection(tableName, filter, cbOnUpdate, cbOnError) {
  // Get initial data
  let query = supabase.from(tableName).select('*');
  
  if (filter) {
    // Apply filter (you may need to customize this based on your needs)
    query = query.match(filter);
  }
  
  query.then(({ data, error }) => {
    if (error) {
      if (typeof cbOnError === 'function') cbOnError(error);
      return;
    }
    cbOnUpdate(data || []);
  });
  
  // Subscribe to changes
  const subscription = supabase
    .channel(`collection-${tableName}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName
      },
      async () => {
        // Refetch data on any change
        let query = supabase.from(tableName).select('*');
        if (filter) query = query.match(filter);
        
        const { data, error } = await query;
        if (error) {
          if (typeof cbOnError === 'function') cbOnError(error);
          return;
        }
        cbOnUpdate(data || []);
      }
    )
    .subscribe();
  
  return () => subscription.unsubscribe();
}

/* -----------------------
   Export everything
   ----------------------- */
export {
  supabase,
  signup,
  login,
  logout,
  resetPassword,
  uploadImageForUser,
  sendMessageToChat,
  subscribeToChat,
  updateUserProfile,
  deleteCurrentUserAccount,
  subscribeToCollection,
  onAuthStateChanged,
  getUserProfile,
  getUserFriendsList,
  ensureChatExists,
  // Notification controls
  setNotificationsEnabled,
  setNotificationSound,
  playNotificationSound,
  startGlobalNotifications,
  stopGlobalNotifications
};