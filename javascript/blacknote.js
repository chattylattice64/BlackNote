// /javascript/search.js
import { supabase } from './supabase.js';

let searchTimeout;

// Initialize search functionality
export function initializeSearch() {
  const searchBox = document.querySelector('.search-box');
  const searchContainer = document.querySelector('.search-container');
  
  if (!searchBox) return;
  
  // Create results dropdown
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'search-results';
  resultsDiv.style.display = 'none';
  searchContainer.appendChild(resultsDiv);
  
  // Search on input
  searchBox.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const searchTerm = e.target.value.trim();
    
    if (searchTerm.length < 2) {
      hideResults(resultsDiv);
      return;
    }
    
    searchTimeout = setTimeout(() => {
      performSearch(searchTerm, resultsDiv);
    }, 300); // Debounce 300ms
  });
  
  // Hide results when clicking outside
  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target)) {
      hideResults(resultsDiv);
    }
  });
  
  // Keep results open when clicking inside search
  searchBox.addEventListener('focus', () => {
    if (resultsDiv.innerHTML) {
      resultsDiv.style.display = 'block';
    }
  });
}

// Perform the search
async function performSearch(searchTerm, resultsDiv) {
  try {
    showLoading(resultsDiv);
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      showError(resultsDiv, "Please sign in to search");
      return;
    }
    
    const lowerSearch = searchTerm.toLowerCase();
    const userResults = [];
    const postResults = [];
    
    // Get current user's friends list
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('friends')
      .eq('uid', user.id)
      .single();
    
    if (userError) {
      console.error('Error fetching user data:', userError);
      showError(resultsDiv, "Error loading your profile");
      return;
    }
    
    const friendsList = userData?.friends || [];
    
    // If no friends, show message
    if (friendsList.length === 0) {
      showError(resultsDiv, "Add some friends to start searching!");
      return;
    }
    
    // Search ONLY friends by username and name
    const { data: allUsers, error: usersError } = await supabase
      .from('users')
      .select('*')
      .in('uid', friendsList);
    
    if (usersError) {
      console.error('Error fetching users:', usersError);
    } else if (allUsers) {
      allUsers.forEach((user) => {
        const username = (user.username || '').toLowerCase();
        const name = (user.name || '').toLowerCase();
        
        if (username.includes(lowerSearch) || name.includes(lowerSearch)) {
          userResults.push({
            type: 'user',
            id: user.uid,
            data: user
          });
        }
      });
    }
    
    // Search posts from FRIENDS ONLY
    const { data: allPosts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .in('author', friendsList);
    
    if (postsError) {
      console.error('Error fetching posts:', postsError);
    } else if (allPosts) {
      allPosts.forEach((post) => {
        // Check multiple possible field names for post text
        const postText = (
          post.text || 
          post.content || 
          post.body || 
          post.message || 
          ''
        ).toLowerCase();
        
        const matchesSearch = postText.includes(lowerSearch);
        
        // Only include posts that match search
        if (matchesSearch && postText.length > 0) {
          postResults.push({
            type: 'post',
            id: post.id,
            data: post
          });
        }
      });
    }
    
    // Limit results
    const limitedUsers = userResults.slice(0, 5);
    const limitedPosts = postResults.slice(0, 5);
    
    // Display results
    await displayResults(limitedUsers, limitedPosts, resultsDiv, searchTerm);
    
  } catch (error) {
    console.error('Search error:', error);
    showError(resultsDiv, "Search failed. Please try again.");
  }
}

// Display search results with sections
async function displayResults(userResults, postResults, resultsDiv, searchTerm) {
  if (userResults.length === 0 && postResults.length === 0) {
    resultsDiv.innerHTML = `
      <div class="search-no-results">
        No friends found matching "${searchTerm}"
      </div>
    `;
    resultsDiv.style.display = 'block';
    return;
  }
  
  let html = '';
  
  // Friends Section (changed from "People")
  if (userResults.length > 0) {
    html += '<div class="search-section">';
    html += '<div class="search-section-title">Friends</div>';
    html += '<div class="search-results-list">';
    
    userResults.forEach(result => {
      const userData = result.data;
      // Use name first, then username, then 'U' as fallback
      const displayText = userData.name || userData.username || 'User';
      const avatar = userData.pfp 
        ? `<img src="${userData.pfp}" alt="${displayText}">` 
        : `<div class="avatar-initial">${displayText[0].toUpperCase()}</div>`;
      
      html += `
        <a href="/pages/profileblacknote.html?uid=${result.id}" class="search-result-item">
          <div class="search-avatar">${avatar}</div>
          <div class="search-info">
            <div class="search-name">${displayText}</div>
          </div>
        </a>
      `;
    });
    
    html += '</div></div>';
  }
  
  // Friends' Posts Section ONLY
  if (postResults.length > 0) {
    html += '<div class="search-section">';
    html += '<div class="search-section-title">Friends\' Posts</div>';
    html += '<div class="search-results-list">';
    
    const postsHtml = await generatePostsHtml(postResults);
    html += postsHtml;
    
    html += '</div></div>';
  }
  
  resultsDiv.innerHTML = html;
  resultsDiv.style.display = 'block';
}

// Helper function to generate posts HTML
async function generatePostsHtml(postResults) {
  const postHtmlPromises = postResults.map(async (result) => {
    const postData = result.data;
    
    try {
      // Get author info from Supabase
      const { data: authorData, error: authorError } = await supabase
        .from('users')
        .select('*')
        .eq('uid', postData.author)
        .single();
      
      let authorName = 'Unknown';
      let authorUsername = 'unknown';
      let authorPfp = null;
      
      if (!authorError && authorData) {
        authorName = authorData.name || authorData.username || 'User';
        authorUsername = authorData.username || 'user';
        authorPfp = authorData.pfp;
      }
      
      // Use name or username for initial
      const displayText = authorName;
      const avatar = authorPfp 
        ? `<img src="${authorPfp}" alt="${displayText}">` 
        : `<div class="avatar-initial">${displayText[0].toUpperCase()}</div>`;
      
      // Get post text from multiple possible fields
      const postText = postData.text || postData.content || postData.body || postData.message || '';
      const truncatedText = postText.length > 100 ? postText.substring(0, 100) + '...' : postText;
      
      return `
        <a href="/pages/home.html#post-${result.id}" class="search-result-item search-post-item">
          <div class="search-avatar">${avatar}</div>
          <div class="search-info">
            <div class="search-post-author">
              <span class="search-name">${authorName}</span>
            </div>
            <div class="search-post-text">${truncatedText}</div>
          </div>
        </a>
      `;
    } catch (err) {
      console.error('Error getting author info:', err);
      return '';
    }
  });
  
  const postHtmlArray = await Promise.all(postHtmlPromises);
  return postHtmlArray.join('');
}

// Show loading state
function showLoading(resultsDiv) {
  resultsDiv.innerHTML = `
    <div class="search-loading">
      <span>Searching...</span>
    </div>
  `;
  resultsDiv.style.display = 'block';
}

// Show error
function showError(resultsDiv, message) {
  resultsDiv.innerHTML = `
    <div class="search-error">
      ${message}
    </div>
  `;
  resultsDiv.style.display = 'block';
}

// Hide results
function hideResults(resultsDiv) {
  resultsDiv.style.display = 'none';
}