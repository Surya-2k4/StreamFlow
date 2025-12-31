const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';

const elements = {
    video: document.getElementById('video'),
    videoContainer: document.getElementById('videoContainer'),
    playerPlaceholder: document.getElementById('playerPlaceholder'),
    channelsGrid: document.getElementById('channelsGrid'),
    channelsSection: document.querySelector('.channels-section'), // Added selection for scroll container
    searchInput: document.getElementById('searchInput'),
    channelCount: document.getElementById('channelCount'),
    loadingSpinner: document.getElementById('loadingSpinner'),
    currentChannelName: document.getElementById('currentChannelName'),
    currentChannelGroup: document.getElementById('currentChannelGroup')
};

let allChannels = [];
let hls = null;
const PAGE_SIZE = 50;
let currentPage = 1;
let currentSearch = '';

// Initialize HLS
if (Hls.isSupported()) {
    hls = new Hls();
}

async function initApp() {
    try {
        const response = await fetch(M3U_URL);
        if (!response.ok) throw new Error('Failed to fetch playlist');
        const text = await response.text();
        allChannels = parseM3U(text);

        elements.loadingSpinner.style.display = 'none';
        updateChannelCount(allChannels.length);
        renderChannels(allChannels.slice(0, PAGE_SIZE));

        // Setup Infinite Scroll on the channels container
        if (elements.channelsSection) {
            elements.channelsSection.addEventListener('scroll', handleScroll);
        } else {
            // Fallback for mobile or different layouts if class differs
            window.addEventListener('scroll', handleScroll);
        }

    } catch (error) {
        console.error('Error:', error);
        elements.loadingSpinner.innerHTML = `<p style="color:red">Failed to load channels. ${error.message}</p>`;
    }
}

function parseM3U(content) {
    const lines = content.split('\n');
    const channels = [];
    let currentChannel = {};

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
            const infoMap = {};
            const attributes = line.match(/([a-zA-Z0-9\-]+)="([^"]*)"/g) || [];
            attributes.forEach(attr => {
                const [key, value] = attr.split('=');
                infoMap[key] = value.replace(/"/g, '');
            });

            const nameParts = line.split(',');
            const name = nameParts[nameParts.length - 1].trim();

            currentChannel = {
                name: name || 'Unknown Channel',
                logo: infoMap['tvg-logo'] || '',
                group: infoMap['group-title'] || 'Uncategorized',
                id: infoMap['tvg-id'] || '',
                url: ''
            };
        } else if (line.startsWith('http')) {
            currentChannel.url = line;
            if (currentChannel.name) {
                channels.push(currentChannel);
            }
            currentChannel = {};
        }
    }
    return channels;
}

function renderChannels(channels, append = false) {
    if (!append) {
        elements.channelsGrid.innerHTML = '';
        currentPage = 1;
    }

    if (channels.length === 0 && !append) {
        elements.channelsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 20px;">No channels found</div>';
        return;
    }

    const fragment = document.createDocumentFragment();

    channels.forEach(channel => {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.onclick = () => playChannel(channel, card);

        const logoHtml = channel.logo ?
            `<img src="${channel.logo}" alt="${channel.name}" class="channel-logo" loading="lazy" onerror="this.onerror=null;this.replaceWith(createPlaceholder('${channel.name}'))">` :
            createPlaceholderHtml(channel.name);

        card.innerHTML = `
            ${logoHtml}
            <div class="channel-details">
                <div class="channel-name" title="${channel.name}">${channel.name}</div>
                <div class="channel-group" title="${channel.group}">${channel.group}</div>
            </div>
        `;
        fragment.appendChild(card);
    });

    elements.channelsGrid.appendChild(fragment);
}

function createPlaceholderHtml(name) {
    const initials = (name.slice(0, 2) || '??').toUpperCase();
    return `<div class="channel-logo-placeholder">${initials}</div>`;
}

window.createPlaceholder = (name) => {
    const div = document.createElement('div');
    div.className = 'channel-logo-placeholder';
    div.textContent = (name.slice(0, 2) || '??').toUpperCase();
    return div;
};

function playChannel(channel, cardElement) {
    document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('active'));
    if (cardElement) cardElement.classList.add('active');

    elements.currentChannelName.textContent = channel.name;
    elements.currentChannelGroup.textContent = channel.group;
    elements.playerPlaceholder.classList.add('hidden');

    // Scroll to top on mobile when clicking a channel so they see the player
    if (window.innerWidth <= 900) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Set a timeout to detect stuck loading (e.g., 10 seconds)
    loadTimeout = setTimeout(() => {
        showPlayerError("The connection timed out. The stream may be offline.");
    }, 15000);

    if (Hls.isSupported()) {
        if (hls) hls.destroy();
        hls = new Hls({
            manifestLoadingTimeOut: 15000,
            manifestLoadingMaxRetry: 2,
            levelLoadingTimeOut: 15000,
            fragLoadingTimeOut: 15000
        });

        hls.loadSource(channel.url);
        hls.attachMedia(elements.video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            clearTimeout(loadTimeout);
            elements.playerPlaceholder.classList.add('hidden');
            elements.video.style.display = 'block';

            elements.video.play().catch(e => {
                console.log('Auto-play blocked:', e);
                // Show play button overlay if needed, or just let user click native controls
            });
            updateTrackControls();
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                clearTimeout(loadTimeout);
                console.error('HLS Fatal Error:', data);
                switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hls.recoverMediaError();
                        break;
                    default:
                        hls.destroy();
                        showPlayerError("Stream format not supported or stream is dead.");
                        break;
                }
            }
        });

        // Handle non-fatal network errors that might still mean dead stream
        hls.on(Hls.Events.u, (event, data) => {
            // Intentionally empty - just monitoring
        });

    } else if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
        elements.video.src = channel.url;

        elements.video.onerror = () => {
            clearTimeout(loadTimeout);
            showPlayerError("Native player error. Stream not supported.");
        };

        elements.video.addEventListener('loadedmetadata', () => {
            clearTimeout(loadTimeout);
            elements.playerPlaceholder.classList.add('hidden');
            elements.video.style.display = 'block';
            elements.video.play();
            document.getElementById('playerControls').style.display = 'none';
        });
    }
}

function updateTrackControls() {
    if (!hls) return;

    const audioSelect = document.getElementById('audioTracks');
    const subtitleSelect = document.getElementById('subtitleTracks');
    const controlsDiv = document.getElementById('playerControls');

    // Audio Tracks
    const audioTracks = hls.audioTracks;
    audioSelect.innerHTML = '';

    if (audioTracks.length > 0) {
        audioTracks.forEach((track, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.text = track.name || `Audio ${index + 1} (${track.lang || 'unk'})`;
            if (hls.audioTrack === index) option.selected = true;
            audioSelect.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.text = "Default Audio (Stream Original)";
        option.value = "-1";
        audioSelect.appendChild(option);
    }

    // Subtitle Tracks
    const subtitles = hls.subtitleTracks;
    subtitleSelect.innerHTML = '<option value="-1">Off</option>';

    if (subtitles.length > 0) {
        subtitles.forEach((track, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.text = track.name || `Subtitle ${index + 1} (${track.lang || 'unk'})`;
            if (hls.subtitleTrack === index) option.selected = true;
            subtitleSelect.appendChild(option);
        });
    }

    // Show controls if we have options, or if we just want them visible for UI consistency
    // User requested to see them.
    controlsDiv.style.display = 'flex';

    if (audioTracks.length === 0) {
        // ensure Default is there if logical branch didn't catch it (it did above, but just for clarity)
        // The above logic handles it.
    }
}

// Add listeners for the controls
document.getElementById('audioTracks').addEventListener('change', (e) => {
    if (hls) {
        hls.audioTrack = parseInt(e.target.value);
    }
});

document.getElementById('subtitleTracks').addEventListener('change', (e) => {
    if (hls) {
        hls.subtitleTrack = parseInt(e.target.value);
    }
});


function handleScroll() {
    // Determine the scroll target
    const container = elements.channelsSection || document.documentElement;

    // Check scroll position for infinite loading
    const scrollTop = container.scrollTop || window.scrollY;
    const scrollHeight = container.scrollHeight || document.documentElement.scrollHeight;
    const clientHeight = container.clientHeight || window.innerHeight;

    if ((scrollTop + clientHeight) >= scrollHeight - 500) {
        loadMoreChannels();
    }
}

function loadMoreChannels() {
    const query = elements.searchInput.value.toLowerCase();
    let filtered = allChannels;

    if (query) {
        filtered = allChannels.filter(c =>
            c.name.toLowerCase().includes(query) ||
            c.group.toLowerCase().includes(query)
        );
    }

    const start = currentPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const nextBatch = filtered.slice(start, end);

    if (nextBatch.length > 0) {
        renderChannels(nextBatch, true);
        currentPage++;
    }
}

function updateChannelCount(count) {
    elements.channelCount.textContent = `${count} channels`;
}

elements.searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    currentSearch = query;

    const filtered = allChannels.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.group.toLowerCase().includes(query)
    );

    updateChannelCount(filtered.length);
    renderChannels(filtered.slice(0, PAGE_SIZE));

    // Reset scroll position on search
    if (elements.channelsSection) {
        elements.channelsSection.scrollTop = 0;
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
});

// --- Music Feature Integration ---

const musicElements = {
    navTv: document.getElementById('navTv'),
    navMusic: document.getElementById('navMusic'),
    tvSection: document.getElementById('tvSection'),
    musicSection: document.getElementById('musicSection'),
    tvSearchBar: document.getElementById('tvSearchBar'),
    musicSearchBar: document.getElementById('musicSearchBar'),
    musicSearchInput: document.getElementById('musicSearchInput'),
    musicGrid: document.getElementById('musicGrid'),
    musicPlaceholder: document.getElementById('musicPlaceholder'),
    audioPlayer: document.getElementById('audioPlayer'),
    musicCover: document.getElementById('musicCover'),
    musicTitle: document.getElementById('musicTitle'),
    musicArtist: document.getElementById('musicArtist')
};

const newsElements = {
    navNews: document.getElementById('navNews'),
    newsSection: document.getElementById('newsSection'),
    newsSearchBar: document.getElementById('newsSearchBar'),
    newsGrid: document.getElementById('newsGrid'),
    newsCountry: document.getElementById('newsCountry'),
    newsCategory: document.getElementById('newsCategory'),
    newsSearchInput: document.getElementById('newsSearchInput'),
    refreshBtn: document.getElementById('refreshNewsBtn')
};

let newsAutoRefreshInterval = null;

// Mode Switching
function switchMode(mode) {
    // Stop any active auto-refresh
    if (newsAutoRefreshInterval) {
        clearInterval(newsAutoRefreshInterval);
        newsAutoRefreshInterval = null;
    }

    // Reset Active States
    [musicElements.navTv, musicElements.navMusic, newsElements.navNews].forEach(el => el.classList.remove('active'));

    // Hide Sections
    musicElements.tvSection.style.display = 'none';
    musicElements.musicSection.style.display = 'none';
    newsElements.newsSection.style.display = 'none';

    // Hide Search Bars
    musicElements.tvSearchBar.style.display = 'none';
    musicElements.musicSearchBar.style.display = 'none';
    newsElements.newsSearchBar.style.display = 'none';

    // Pause Media
    elements.video.pause();
    musicElements.audioPlayer.pause();

    // Activate Mode
    if (mode === 'tv') {
        musicElements.navTv.classList.add('active');
        musicElements.tvSection.style.display = 'flex';
        musicElements.tvSearchBar.style.display = 'flex';
    } else if (mode === 'music') {
        musicElements.navMusic.classList.add('active');
        musicElements.musicSection.style.display = 'flex';
        musicElements.musicSearchBar.style.display = 'flex';
    } else if (mode === 'news') {
        newsElements.navNews.classList.add('active');
        newsElements.newsSection.style.display = 'flex';
        newsElements.newsSearchBar.style.display = 'flex';

        // Initial load if empty
        if (newsElements.newsGrid.children.length <= 1) {
            fetchNews();
        }

        // Start Auto-Refresh (every 2 minutes)
        newsAutoRefreshInterval = setInterval(() => {
            console.log('Auto-refreshing news...');
            fetchNews(true); // check for true in fetchNews to show non-intrusive loading if needed
        }, 120000);
    }
}

musicElements.navTv.addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('tv');
});

musicElements.navMusic.addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('music');
});

newsElements.navNews.addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('news');
});

// Music Search
let musicDebounceTimer;
musicElements.musicSearchInput.addEventListener('input', (e) => {
    clearTimeout(musicDebounceTimer);
    const query = e.target.value.trim();

    if (query.length < 2) return;

    musicDebounceTimer = setTimeout(() => {
        searchMusic(query);
    }, 500);
});

async function searchMusic(query) {
    musicElements.musicGrid.innerHTML = `
        <div class="loading-spinner" style="grid-column: 1/-1;">
            <div class="spinner"></div>
            <p>Searching for "${query}"...</p>
        </div>
    `;

    try {
        // Using 'seevn' (Saavn) engine as it's often reliable for this API
        const response = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=25`);
        if (!response.ok) throw new Error('Network response was not ok');

        const data = await response.json();
        const results = data.results;

        if (!results || results.length === 0) {
            musicElements.musicGrid.innerHTML = '<p style="text-align: center; width: 100%; color: var(--text-secondary);">No songs found.</p>';
            return;
        }

        renderMusicResults(results);

    } catch (error) {
        console.error('Music Search Error:', error);
        musicElements.musicGrid.innerHTML = `<p style="color: #ef4444; text-align: center; width: 100%;">Failed to search music. Please try again.</p>`;
    }
}

function renderMusicResults(songs) {
    musicElements.musicGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    songs.forEach(song => {
        const card = document.createElement('div');
        card.className = 'channel-card'; // Reuse existing card style

        // Get higher resolution image
        const imgUrl = song.artworkUrl100 ? song.artworkUrl100.replace('100x100', '300x300') : 'https://via.placeholder.com/100';

        card.innerHTML = `
            <img src="${imgUrl}" alt="${song.trackName}" class="channel-logo" style="border-radius: 4px;">
            <div class="channel-details">
                <div class="channel-name" title="${song.trackName}">${song.trackName}</div>
                <div class="channel-group" title="${song.artistName}">${song.artistName}</div>
            </div>
        `;

        card.onclick = () => playMusic(song, card);
        fragment.appendChild(card);
    });

    musicElements.musicGrid.appendChild(fragment);
}

function playMusic(song, cardElement) {
    // Highlight active card
    document.querySelector('#musicGrid .active')?.classList.remove('active');
    if (cardElement) cardElement.classList.add('active');

    // Update Player UI
    musicElements.musicTitle.textContent = song.trackName;
    musicElements.musicArtist.textContent = song.artistName;

    if (song.artworkUrl100) {
        const highResRaw = song.artworkUrl100.replace('100x100', '600x600');
        musicElements.musicCover.src = highResRaw;
        musicElements.musicCover.style.display = 'block';
        document.querySelector('.album-art-large i').style.display = 'none';
    }

    // Play Audio (Preview URL)
    const audioUrl = song.previewUrl;

    if (audioUrl) {
        musicElements.audioPlayer.src = audioUrl;
        musicElements.audioPlayer.play().catch(e => console.error("Audio play failed:", e));
    } else {
        alert("Audio preview not available for this song.");
    }
}

// --- News Feature Integration ---

let allNews = [];

// Mapping for Google News parameters
const countryConfig = {
    'us': { lang: 'en', gl: 'US', ceid: 'US:en' },
    'in': { lang: 'en', gl: 'IN', ceid: 'IN:en' },
    'gb': { lang: 'en', gl: 'GB', ceid: 'GB:en' },
    'au': { lang: 'en', gl: 'AU', ceid: 'AU:en' },
    'fr': { lang: 'fr', gl: 'FR', ceid: 'FR:fr' },
    'ru': { lang: 'ru', gl: 'RU', ceid: 'RU:ru' }
};

async function fetchNews() {
    const country = newsElements.newsCountry.value;
    const category = newsElements.newsCategory.value;
    const config = countryConfig[country] || countryConfig['us'];

    newsElements.newsGrid.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p>Loading live headlines for ${category} (${country.toUpperCase()})...</p>
        </div>
    `;

    try {
        // Construct Google News RSS URL
        let rssUrl = '';
        if (category === 'general') {
            rssUrl = `https://news.google.com/rss?hl=${config.lang}-${config.gl}&gl=${config.gl}&ceid=${config.ceid}`;
        } else {
            // Google News Topics are usually uppercase e.g. TECHNOLOGY
            rssUrl = `https://news.google.com/rss/headlines/section/topic/${category.toUpperCase()}?hl=${config.lang}-${config.gl}&gl=${config.gl}&ceid=${config.ceid}`;
        }

        // Use rss2json to convert RSS to JSON
        const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);

        if (!response.ok) throw new Error('Failed to fetch news feed');

        const data = await response.json();

        if (data.status !== 'ok') {
            throw new Error('Feed conversion failed');
        }

        allNews = data.items;
        renderNews(allNews);

    } catch (error) {
        console.error('News Fetch Error:', error);
        newsElements.newsGrid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 20px;">
                <p style="color: #ef4444; margin-bottom: 10px;">Failed to load live news.</p>
                <p style="color: var(--text-secondary); font-size: 0.9rem;">${error.message}</p>
                <button onclick="fetchNews()" class="read-more-btn" style="background: var(--surface-hover); margin-top: 10px; cursor: pointer;">Retry</button>
            </div>`;
    }
}

function renderNews(articles) {
    newsElements.newsGrid.innerHTML = '';

    if (!articles || articles.length === 0) {
        newsElements.newsGrid.innerHTML = '<p style="text-align: center; width: 100%; color: var(--text-secondary);">No headlines found.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();

    articles.forEach(article => {
        const card = document.createElement('div');
        card.className = 'news-card';

        // 1. Try standard RSS fields
        let imgUrl = article.enclosure?.link || article.thumbnail;

        // 2. Try to extract image from description if standard fields fail
        if (!imgUrl && article.description) {
            const imgMatch = article.description.match(/src="([^"]+)"/);
            if (imgMatch && imgMatch[1]) {
                imgUrl = imgMatch[1];
            }
        }

        // 3. Fallback: Generate a unique consistent image based on the article title
        if (!imgUrl) {
            const seed = encodeURIComponent(article.title.substring(0, 20).replace(/[^a-zA-Z0-9]/g, ''));
            imgUrl = `https://picsum.photos/seed/${seed}/600/400`;
        }

        // Handle date
        let dateStr = 'Just now';
        try {
            dateStr = new Date(article.pubDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch (e) { }

        // Clean title (Google News often adds "- SourceName" at the end)
        let title = article.title;
        let sourceName = 'News Source';
        const sourceMatch = title.lastIndexOf('-');
        if (sourceMatch !== -1) {
            sourceName = title.substring(sourceMatch + 1).trim();
            title = title.substring(0, sourceMatch).trim();
        }

        card.innerHTML = `
            <div class="news-image-container">
                <img src="${imgUrl}" alt="News" class="news-image" loading="lazy" onerror="this.src='https://picsum.photos/seed/${Math.random()}/600/400'">
            </div>
            <div class="news-content">
                <div class="news-source">
                    <span>${sourceName}</span>
                    <span>${dateStr}</span>
                </div>
                <div class="news-title" title="${article.title}">${title}</div>
                <div class="news-footer">
                    <a href="${article.link}" target="_blank" class="read-more-btn">Read Full Story <i class="fa-solid fa-arrow-right"></i></a>
                </div>
            </div>
        `;
        fragment.appendChild(card);
    });

    newsElements.newsGrid.appendChild(fragment);
}

function getCategoryPlaceholder(category) {
    const placeholders = {
        'general': 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=600&auto=format&fit=crop',
        'technology': 'https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=600&auto=format&fit=crop',
        'business': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=600&auto=format&fit=crop',
        'entertainment': 'https://images.unsplash.com/photo-1603190287605-e6ade32fa852?q=80&w=600&auto=format&fit=crop',
        'sports': 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?q=80&w=600&auto=format&fit=crop',
        'science': 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?q=80&w=600&auto=format&fit=crop',
        'health': 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?q=80&w=600&auto=format&fit=crop'
    };
    return placeholders[category] || placeholders['general'];
}

// News Filters
newsElements.newsCountry.addEventListener('change', () => fetchNews());
newsElements.newsCategory.addEventListener('change', () => fetchNews());
newsElements.refreshBtn.addEventListener('click', () => {
    // Add rotation animation reset
    const icon = newsElements.refreshBtn.querySelector('i');
    icon.style.transition = 'transform 1s ease';
    icon.style.transform = 'rotate(360deg)';
    setTimeout(() => { icon.style.transform = 'none'; icon.style.transition = 'all 0.3s ease'; }, 1000);

    fetchNews();
});

// News Search (Client-side)
newsElements.newsSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allNews.filter(article =>
        (article.title && article.title.toLowerCase().includes(query))
    );
    renderNews(filtered);
});

initApp();
