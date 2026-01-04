
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// --- SUPABASE CONFIGURATION ---
const supabaseUrl = 'https://dytfyrtiowvrevqjbghn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5dGZ5cnRpb3d2cmV2cWpiZ2huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODU4OTEsImV4cCI6MjA4Mjg2MTg5MX0.h9CH4Rup-31mV5JOVL5NMXzrM5u0Q_UGO9St66yBJIg';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- AUTH HELPERS ---

export const auth = {
  get currentUser() {
    return supabase.auth.getSession().then(({ data }) => data.session?.user || null);
  },
  // Mocking the Firebase onAuthStateChanged observer
  onAuthStateChanged: (callback) => {
    supabase.auth.getSession().then(({ data }) => {
      if(data.session?.user) {
        // Map Supabase user to look like Firebase user
        const user = mapUser(data.session.user);
        callback(user);
      } else {
        callback(null);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ? mapUser(session.user) : null);
    });
    return () => subscription.unsubscribe();
  }
};

function mapUser(sbUser) {
  if (!sbUser) return null;
  return {
    uid: sbUser.id,
    email: sbUser.email,
    emailVerified: true, // Assuming true for simplicity in migration
    displayName: sbUser.user_metadata?.display_name || sbUser.user_metadata?.name || '',
    photoURL: sbUser.user_metadata?.avatar_url || null
  };
}

export const onAuthStateChanged = (authObj, callback) => {
  return auth.onAuthStateChanged(callback);
};

export async function signup(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } }
  });
  if (error) throw error;
  
  // Create user profile immediately
  if (data.user) {
    await setDoc(doc(null, 'users', data.user.id), {
      uid: data.user.id,
      email: email,
      name: displayName || "",
      username: email.split('@')[0],
      pfp: null,
      bio: "",
      friends: [],
      friendRequests: [],
      createdAt: serverTimestamp()
    });
  }
  return data.user;
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function logout() {
  await supabase.auth.signOut();
}

export async function resendVerificationEmail() {
  // Supabase handles this differently, usually via signUp resend. 
  // For now we assume successful signup sends email.
  return true; 
}

// --- STORAGE HELPERS ---

export async function uploadImageForUser(file, uid) {
  const fileExt = file.name.split('.').pop();
  const fileName = `${uid}/${Date.now()}.${fileExt}`;
  const filePath = `${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from('user-images') // Ensure this bucket exists in Supabase
    .upload(filePath, file);

  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('user-images')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

// --- FIRESTORE COMPATIBILITY LAYER (THE ADAPTER) ---

// Mocking the 'db' object required by imports
export const db = {}; 

// Mocking 'serverTimestamp'
export function serverTimestamp() {
  return new Date().toISOString(); 
}

// 1. References
export function collection(db, collectionName, ...pathSegments) {
  // Handle nested collections like chats/ID/messages
  if (pathSegments.length > 0) {
      // Logic to handle nested paths if strictly necessary, 
      // but simplistic mapping: collection('chats', id, 'messages') -> table 'messages' with filter on chat_id
      if(collectionName === 'chats' && pathSegments[1] === 'messages') {
          return { table: 'messages', parentId: pathSegments[0] };
      }
  }
  return { table: collectionName };
}

export function doc(db, collectionName, id, ...pathSegments) {
  // If first arg is a collection reference object
  if (db && db.table) {
      return { table: db.table, id: collectionName }; // collectionName here is actually the ID
  }
  
  // Handle nested docs
  if (pathSegments.length > 0) {
      // Simple fallback for deep nesting
      return { table: pathSegments[pathSegments.length - 2], id: pathSegments[pathSegments.length - 1] };
  }

  return { table: collectionName, id: id };
}

// 2. Writes
export async function setDoc(docRef, data, options = {}) {
  // Handle 'merge' by checking existence first or using upsert
  const { error } = await supabase
    .from(docRef.table)
    .upsert({ id: docRef.id, ...data }); // Assuming 'id' column maps to doc ID
  if (error) throw error;
}

export async function updateDoc(docRef, data) {
  // Intercept array operations
  const updates = { ...data };
  
  // Check for array operations
  for (const key in updates) {
    if (updates[key] && updates[key].__op === 'union') {
      // Complex: need to fetch, push, update
      const { data: curr } = await supabase.from(docRef.table).select(key).eq('id', docRef.id).single();
      const currentArr = curr ? (curr[key] || []) : [];
      const newArr = [...new Set([...currentArr, ...updates[key].elements])];
      updates[key] = newArr;
    } else if (updates[key] && updates[key].__op === 'remove') {
      const { data: curr } = await supabase.from(docRef.table).select(key).eq('id', docRef.id).single();
      const currentArr = curr ? (curr[key] || []) : [];
      const toRemove = updates[key].elements;
      const newArr = currentArr.filter(item => !toRemove.includes(item));
      updates[key] = newArr;
    }
  }

  const { error } = await supabase
    .from(docRef.table)
    .update(updates)
    .eq('id', docRef.id); // Assuming 'id' is the primary key name
  if (error) throw error;
}

export async function addDoc(collectionRef, data) {
  // Supabase insert returns the data, we need the ID
  // If it's the messages table, map author info
  const payload = { ...data };
  
  // For 'messages' subcollection simulation
  if (collectionRef.parentId) {
      payload.chat_id = collectionRef.parentId;
  }

  const { data: inserted, error } = await supabase
    .from(collectionRef.table)
    .insert(payload)
    .select()
    .single();
    
  if (error) throw error;
  return { id: inserted.id };
}

export async function deleteDoc(docRef) {
  const { error } = await supabase
    .from(docRef.table)
    .delete()
    .eq('id', docRef.id);
  if (error) throw error;
}

export function arrayUnion(...elements) {
  return { __op: 'union', elements };
}

export function arrayRemove(...elements) {
  return { __op: 'remove', elements };
}

// 3. Reads
export async function getDoc(docRef) {
  const { data, error } = await supabase
    .from(docRef.table)
    .select('*')
    .eq('id', docRef.id) // Assuming column is 'id' or 'uid'
    .maybeSingle();

  if (error) {
      console.error(error);
      return { exists: () => false };
  }

  return {
    exists: () => !!data,
    data: () => data,
    id: docRef.id
  };
}

export async function getDocs(queryRef) {
  let query = supabase.from(queryRef.table).select('*');
  
  // Apply constraints
  if (queryRef.constraints) {
    queryRef.constraints.forEach(c => {
      if (c.type === 'where') query = query.eq(c.field, c.value); // Simple equality mapping
      if (c.type === 'orderBy') query = query.order(c.field, { ascending: c.dir === 'asc' });
      if (c.type === 'limit') query = query.limit(c.limit);
      if (c.type === 'array-contains') query = query.contains(c.field, [c.value]);
    });
  }
  
  // Handle parent ID for subcollections
  if (queryRef.parentId) {
      query = query.eq('chat_id', queryRef.parentId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    empty: data.length === 0,
    docs: data.map(d => ({
      id: d.id,
      data: () => d
    })),
    forEach: (cb) => data.forEach((d) => cb({ id: d.id, data: () => d }))
  };
}

// 4. Queries
export function query(collectionRef, ...constraints) {
  return {
    table: collectionRef.table,
    parentId: collectionRef.parentId,
    constraints: constraints
  };
}

export function where(field, op, value) {
  // Supabase simple filtering mapping. 
  // 'array-contains' is special in Supabase
  if (op === 'array-contains') return { type: 'array-contains', field, value };
  return { type: 'where', field, op, value }; 
}

export function orderBy(field, dir = 'asc') {
  return { type: 'orderBy', field, dir };
}

export function limit(num) {
  return { type: 'limit', limit: num };
}

// 5. Realtime (onSnapshot)
export function onSnapshot(queryOrRef, callback, errorCallback) {
  // If it's a doc ref
  if (queryOrRef.id) {
    const channel = supabase.channel(`doc-${queryOrRef.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: queryOrRef.table, filter: `id=eq.${queryOrRef.id}` },
        async (payload) => {
          // Fetch fresh data to ensure we have full object
          const { data } = await supabase.from(queryOrRef.table).select('*').eq('id', queryOrRef.id).single();
          callback({
            exists: () => !!data,
            data: () => data,
            id: queryOrRef.id
          });
        }
      )
      .subscribe();
      
    // Trigger initial fetch
    getDoc(queryOrRef).then(callback);
    return () => supabase.removeChannel(channel);
  } 
  
  // If it's a collection/query
  else {
    const channelName = `col-${queryOrRef.table}-${Date.now()}`;
    let filter = undefined;
    
    // Attempt to map simple WHERE filters to realtime filters if possible
    // Supabase Realtime filters are limited. 
    
    // For specific use cases in BlackNote:
    // 1. Posts feed (no filter or complex filter) -> Subscribe to all posts
    // 2. Messages (filtered by chat_id) -> Subscribe to messages with chat_id
    
    if (queryOrRef.parentId) {
        filter = `chat_id=eq.${queryOrRef.parentId}`;
    }

    const channel = supabase.channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: queryOrRef.table, filter: filter },
        async (payload) => {
          // On any change, re-fetch the query to match Firestore snapshot behavior (getting the full list)
          // This is inefficient but ensures compatibility with the 'snapshot' object structure expected by the app
          const snapshot = await getDocs(queryOrRef);
          
          // Mimic docChanges if possible, or just return full snapshot
          // We'll attach a basic docChanges method
          snapshot.docChanges = () => {
              if (payload.eventType === 'INSERT') return [{ type: 'added', doc: { id: payload.new.id, data: () => payload.new } }];
              if (payload.eventType === 'UPDATE') return [{ type: 'modified', doc: { id: payload.new.id, data: () => payload.new } }];
              return [];
          };
          snapshot.size = snapshot.docs.length;
          
          callback(snapshot);
        }
      )
      .subscribe();

    // Initial fetch
    getDocs(queryOrRef).then((snapshot) => {
        snapshot.docChanges = () => []; // No changes on init
        snapshot.size = snapshot.docs.length;
        callback(snapshot);
    });
    
    return () => supabase.removeChannel(channel);
  }
}

// --- APP SPECIFIC HELPERS (Bridging calls in existing code) ---

export async function sendMessageToChat(chatId, senderUid, text = "", imageUrl = null) {
  // Ensure chat exists or is tracked
  // Insert message into 'messages' table
  await addDoc({ table: 'messages', parentId: chatId }, {
      sender: senderUid,
      text: text,
      imageUrl: imageUrl,
      timestamp: new Date().toISOString()
  });
  
  // Update chat last message
  await updateDoc(doc(null, 'chats', chatId), {
      lastMessage: text || "Image",
      lastMessageTime: new Date().toISOString()
  });
}

export function subscribeToChat(chatId, cbOnUpdate, cbOnError) {
  const messagesRef = collection(db, 'chats', chatId, 'messages');
  const q = query(messagesRef, orderBy('timestamp', 'asc'));
  return onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      cbOnUpdate(msgs);
  }, cbOnError);
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) throw new Error("User not found");
  return snap.data();
}

export async function getUserFriendsList(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return [];
  return snap.data().friends || [];
}

export function startGlobalNotifications(uid) {
    // Basic implementation for notification bell
    console.log("Global notifications started for", uid);
}