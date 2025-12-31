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

const radioElements = {
    navRadio: document.getElementById('navRadio'),
    radioSection: document.getElementById('radioSection'),
    radioSearchBar: document.getElementById('radioSearchBar'),
    radioSearchInput: document.getElementById('radioSearchInput'),
    radioGrid: document.getElementById('radioGrid'),
    radioPlayer: document.getElementById('radioPlayer'),
    radioName: document.getElementById('radioName'),
    radioTags: document.getElementById('radioTags'),
    radioCover: document.getElementById('radioCover'),
    radioArtContainer: document.getElementById('radioArtContainer'),
    radioCountry: document.getElementById('radioCountry'),
    radioGenre: document.getElementById('radioGenre'),
    // Tuner Elements
    tunerSlider: document.getElementById('tunerSlider'),
    tunerFrequency: document.getElementById('tunerFrequency'),
    tuningIndicator: document.getElementById('tuningIndicator')
};

const weatherElements = {
    section: document.getElementById('weatherSection'),
    input: document.getElementById('weatherSearchInput'),
    btn: document.getElementById('weatherSearchBtn'),

    // Hero
    city: document.getElementById('weatherCity'),
    date: document.getElementById('weatherDate'),
    mainTemp: document.getElementById('weatherMainTemp'),
    mainIcon: document.getElementById('weatherMainIcon'),
    desc: document.getElementById('weatherDesc'),
    wind: document.getElementById('weatherWind'),
    humidity: document.getElementById('weatherHumidity'),

    // Grid
    grid: document.getElementById('forecastGrid')
};

let newsAutoRefreshInterval = null;
let tuningTimeout = null;
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let staticNode = null;
let gainNode = null;

// Generate Static Noise
function createStaticNoise() {
    if (!staticNode) {
        const bufferSize = audioContext.sampleRate * 2; // 2 seconds buffer
        const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        staticNode = audioContext.createBufferSource();
        staticNode.buffer = buffer;
        staticNode.loop = true;

        gainNode = audioContext.createGain();
        gainNode.gain.value = 0.05; // Low volume static

        staticNode.connect(gainNode);
        gainNode.connect(audioContext.destination);
    }
}

function playStatic() {
    if (audioContext.state === 'suspended') audioContext.resume();
    if (!staticNode) {
        createStaticNoise();
        staticNode.start();
    } else {
        gainNode.gain.value = 0.1;
    }
}

function stopStatic() {
    if (gainNode) {
        // fade out
        gainNode.gain.setTargetAtTime(0, audioContext.currentTime, 0.1);
    }
}

// Mode Switching
function switchMode(mode) {
    // Stop any active auto-refresh
    if (newsAutoRefreshInterval) {
        clearInterval(newsAutoRefreshInterval);
        newsAutoRefreshInterval = null;
    }

    // Reset Active States
    [musicElements.navTv, musicElements.navMusic, newsElements.navNews, radioElements.navRadio, document.getElementById('navWeather'), document.getElementById('navFocus'), document.getElementById('navChat')].forEach(el => el.classList.remove('active'));

    // Hide Sections
    musicElements.tvSection.style.display = 'none';
    musicElements.musicSection.style.display = 'none';
    newsElements.newsSection.style.display = 'none';
    radioElements.radioSection.style.display = 'none';
    weatherElements.section.style.display = 'none';
    document.getElementById('focusSection').style.display = 'none';
    document.getElementById('chatSection').style.display = 'none';

    // Hide Search Bars
    musicElements.tvSearchBar.style.display = 'none';
    musicElements.musicSearchBar.style.display = 'none';
    newsElements.newsSearchBar.style.display = 'none';
    radioElements.radioSearchBar.style.display = 'none';

    // Pause Media
    elements.video.pause();
    musicElements.audioPlayer.pause();
    radioElements.radioPlayer.pause();

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
        newsElements.newsSection.style.display = 'grid'; // News uses grid
        newsElements.newsSearchBar.style.display = 'flex';

        if (newsElements.newsGrid.children.length <= 1) {
            fetchNews();
        }

        // Start auto-refresh for news
        newsAutoRefreshInterval = setInterval(fetchNews, 120000);

    } else if (mode === 'radio') {
        radioElements.navRadio.classList.add('active');
        radioElements.radioSection.style.display = 'flex'; // Must be Flex for 2-column layout
        radioElements.radioSearchBar.style.display = 'flex';

        if (allStations.length === 0) {
            fetchRadioStations();
        }
    } else if (mode === 'weather') {
        document.getElementById('navWeather').classList.add('active');
        weatherElements.section.style.display = 'block';
    } else if (mode === 'focus') {
        document.getElementById('navFocus').classList.add('active');
        document.getElementById('focusSection').style.display = 'block';
    } else if (mode === 'chat') {
        document.getElementById('navChat').classList.add('active');
        document.getElementById('chatSection').style.display = 'block';
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

radioElements.navRadio.addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('radio');
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

// --- Radio Feature Integration ---

let allStations = [];
let radioApiBaseUrl = 'https://de1.api.radio-browser.info'; // Default fallback

const RADIO_PLACEHOLDER_IMG = "data:image/jpeg;base64,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`";

// Hardcoded reliable stations for fallback (when API is down/CORS blocks)
const FALLBACK_STATIONS = [
    {
        name: "BBC Radio 1",
        url: "https://stream.live.vc.bbcmedia.co.uk/bbc_radio_one",
        tags: "pop, rock, news, uk",
        favicon: "https://upload.wikimedia.org/wikipedia/commons/4/45/BBC_Radio_1_logo.png"
    },
    {
        name: "NPR Program Stream",
        url: "https://npr-ice.streamguys1.com/live.mp3",
        tags: "news, talk, usa",
        favicon: "https://media.npr.org/chrome/favicon/favicon-96x96.png"
    },
    {
        name: "Capital FM London",
        url: "https://media-ice.musicradio.com/CapitalMP3",
        tags: "pop, hits, chart, uk",
        favicon: "https://global.c.files.bbci.co.uk/16F2/production/_109224483_capital.jpg"
    },
    {
        name: "Classic FM",
        url: "https://media-ice.musicradio.com/ClassicFMMP3",
        tags: "classical, relaxation",
        favicon: "https://upload.wikimedia.org/wikipedia/en/thumb/e/e3/Classic_FM_2024.png/200px-Classic_FM_2024.png"
    },
    {
        name: "Smooth Chill",
        url: "https://media-ice.musicradio.com/SmoothChillMP3",
        tags: "chillout, ambient, easy listening",
        favicon: "https://static.radio.net/images/broadcasts/5e/5d/39669/c300.png"
    },
    {
        name: "LBC UK",
        url: "https://media-ice.musicradio.com/LBCUKMP3",
        tags: "news, talk, debate",
        favicon: "https://upload.wikimedia.org/wikipedia/en/thumb/8/86/LBC_Logo_2021.svg/1200px-LBC_Logo_2021.svg.png"
    },
    {
        name: "Ibiza Global Radio",
        url: "https://icecast.ibizaglobalradio.com/ibizaglobalradio.mp3",
        tags: "electronic, house, dance",
        favicon: "https://ibizaglobalradio.com/wp-content/uploads/2021/03/IGR-logo-negre.png"
    },
    {
        name: "Radio Caroline",
        url: "https://sc3.radiocaroline.co.uk:8443/", // SSL Port often 8443 or similar, or just try https standard
        tags: "rock, oldies, classic rock",
        favicon: "https://www.radiocaroline.co.uk/images/home_logo.png"
    }
];

// Function to find the fastest/active server
async function configureRadioServer() {
    // Hardcoded list of reliable servers to try directly
    const forcedServers = [
        'https://de1.api.radio-browser.info',
        'https://fr1.api.radio-browser.info',
        'https://at1.api.radio-browser.info',
        'https://nl1.api.radio-browser.info'
    ];

    // Pick a random one to start with
    const randomIndex = Math.floor(Math.random() * forcedServers.length);
    radioApiBaseUrl = forcedServers[randomIndex];
    console.log('Forcing Radio Server:', radioApiBaseUrl);
}

async function fetchRadioStations(retryCount = 0) {
    if (!radioApiBaseUrl || retryCount === 0) {
        await configureRadioServer();
    }

    const country = radioElements.radioCountry.value;
    const genre = radioElements.radioGenre.value;

    radioElements.radioGrid.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <p>Scanning frequency bands...</p>
        </div>
    `;

    try {
        // Fetch up to 500 stations to satisfy "include all" request
        let url = `${radioApiBaseUrl}/json/stations/search?limit=500&hidebroken=true&order=clickcount&reverse=true`;

        if (country) url += `&countrycode=${country}`;
        if (genre) url += `&tag=${genre}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch stations');

        allStations = await response.json();
        renderRadioStations(allStations);

        // Reset Tuner to start
        radioElements.tunerSlider.value = 0;
        radioElements.tunerFrequency.textContent = "FM 88.0";

    } catch (error) {
        console.error('Radio Fetch Error:', error);

        // Retry logic with a different server
        if (retryCount < 2) {
            console.log('Retrying with a different server...');
            await configureRadioServer(); // Pick new server
            fetchRadioStations(retryCount + 1);
        } else {
            // FALLBACK MODE
            console.warn('API connection failed. Loading fallback stations.');
            radioElements.radioGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 10px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; margin-bottom: 20px;">
                    <p style="color: var(--text-secondary); font-size: 0.9rem;">
                        <i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i> 
                        Live station list unavailable. Showing popular recommended stations.
                    </p>
                </div>
             `;

            // Manually render the fallback cards
            FALLBACK_STATIONS.forEach(station => {
                const card = document.createElement('div');
                card.className = 'channel-card';

                // Use station favicon or genericon
                const imgUrl = station.favicon || 'https://cdn-icons-png.flaticon.com/512/3075/3075841.png';

                card.innerHTML = `
                    <img src="${imgUrl}" alt="${station.name}" class="channel-logo" style="border-radius: 50%; background:white; padding: 2px;" onerror="this.src='https://cdn-icons-png.flaticon.com/512/3075/3075841.png'">
                    <div class="channel-details">
                        <div class="channel-name" title="${station.name}">${station.name}</div>
                        <div class="channel-group" title="${station.tags}">${station.tags}</div>
                    </div>
                `;
                card.onclick = () => playRadioStation(station, card);
                radioElements.radioGrid.appendChild(card);
            });

            // Update allStations so search still works on fallbacks
            allStations = FALLBACK_STATIONS;
        }
    }
}

function renderRadioStations(stations) {
    radioElements.radioGrid.innerHTML = '';

    if (!stations || stations.length === 0) {
        radioElements.radioGrid.innerHTML = '<p style="text-align: center; width: 100%; color: var(--text-secondary);">No stations found.</p>';
        return;
    }

    const fragment = document.createDocumentFragment();

    stations.forEach(station => {
        const card = document.createElement('div');
        card.className = 'channel-card'; // Reuse styled card

        // Use standard placeholder for all stations per user request
        const imgUrl = RADIO_PLACEHOLDER_IMG;

        card.innerHTML = `
            <img src="${imgUrl}" alt="${station.name}" class="channel-logo" style="border-radius: 50%; background:white; padding: 2px;" onerror="this.src='${RADIO_PLACEHOLDER_IMG}'">
            <div class="channel-details">
                <div class="channel-name" title="${station.name}">${station.name}</div>
                <div class="channel-group" title="${station.tags}">${station.tags.slice(0, 30)}${station.tags.length > 30 ? '...' : ''}</div>
            </div>
        `;

        card.onclick = () => playRadioStation(station, card);
        fragment.appendChild(card);
    });

    radioElements.radioGrid.appendChild(fragment);
}

function playRadioStation(station, cardElement) {
    // Highlight
    document.querySelector('#radioGrid .active')?.classList.remove('active');
    if (cardElement) cardElement.classList.add('active');

    // Update Player UI
    radioElements.radioName.textContent = station.name;
    radioElements.radioTags.textContent = station.tags || 'Unknown Genre';

    if (station.favicon) {
        radioElements.radioCover.src = station.favicon;
        radioElements.radioCover.style.display = 'block';
        radioElements.radioArtContainer.querySelector('i').style.display = 'none';
    } else {
        radioElements.radioCover.style.display = 'none';
        radioElements.radioArtContainer.querySelector('i').style.display = 'inline';
    }

    // Play Stream
    radioElements.radioPlayer.src = station.url_resolved || station.url;
    radioElements.radioPlayer.play().catch(e => console.error("Radio play failed:", e));
}

// Radio Event Listeners
radioElements.radioCountry.addEventListener('change', fetchRadioStations);
radioElements.radioGenre.addEventListener('change', fetchRadioStations);

radioElements.radioSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allStations.filter(s =>
        s.name.toLowerCase().includes(query) ||
        s.tags.toLowerCase().includes(query)
    );
    renderRadioStations(filtered);
});

// Tuner Logic
radioElements.tunerSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);

    // Simulate frequency range 88.0 - 108.0 MHz
    // range 0-100 maps to 88-108 -> span of 20MHz. 0.2MHz per step
    const freq = (88.0 + (val * 0.2)).toFixed(1);
    radioElements.tunerFrequency.textContent = `FM ${freq}`;

    radioElements.tuningIndicator.style.display = 'block';

    // Play static sound
    playStatic();

    // Clear previous selection debounce
    clearTimeout(tuningTimeout);

    // Find station
    if (allStations.length > 0) {
        // Map 0-100 linear range to array index
        const index = Math.floor((val / 100) * (allStations.length - 1));
        const station = allStations[index];

        radioElements.radioName.textContent = `Tuning... ${freq}`;
        radioElements.radioTags.textContent = station ? station.name : 'Searching...';

        tuningTimeout = setTimeout(() => {
            radioElements.tuningIndicator.style.display = 'none';
            stopStatic();
            if (station) {
                // Highlight in grid (optional, might be heavy if list is long)
                // playRadioStation(station); // Don't auto play on every slide, wait for settle
                playRadioStation(station);
            }
        }, 800); // 800ms delay to settle
    }
});

// Update country search options to be generic for US/IN primarily
// Just ensuring default fetch includes India or US if selected
radioElements.radioCountry.value = 'IN'; // Default to India as per user request to include only IN/US (defaulting one)

// --- Weather Feature ---
let currentLat = 11.3410; // Erode Default
let currentLon = 77.7172; // Erode Default

function getWeatherIcon(code) {
    if (code === 0) return '☀️'; // Clear
    if (code > 0 && code <= 3) return '☁️'; // Cloudy
    if (code >= 45 && code <= 48) return '🌫️'; // Fog
    if (code >= 51 && code <= 67) return '🌧️'; // Drizzle/Rain
    if (code >= 71 && code <= 77) return '❄️'; // Snow
    if (code >= 80 && code <= 82) return '🌦️'; // Showers
    if (code >= 95) return '⚡'; // Thunderstorm
    return '🌥️';
}

function getWeatherDesc(code) {
    if (code === 0) return 'Clear Sky';
    if (code > 0 && code <= 3) return 'Cloudy';
    if (code >= 45 && code <= 48) return 'Foggy';
    if (code >= 51 && code <= 67) return 'Rainy';
    if (code >= 71 && code <= 77) return 'Snowy';
    if (code >= 80 && code <= 82) return 'Showers';
    if (code >= 95) return 'Thunderstorm';
    return 'Variable';
}

async function fetchWeather(lat, lon, cityName) {
    currentLat = lat;
    currentLon = lon;

    // Show loading state
    weatherElements.city.textContent = "Loading...";

    try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`);
        const data = await response.json();

        // 1. Render Current Forecast (Hero)
        if (data.current_weather) {
            const current = data.current_weather;
            weatherElements.city.textContent = cityName;
            weatherElements.mainTemp.textContent = `${Math.round(current.temperature)}°C`;
            weatherElements.mainIcon.textContent = getWeatherIcon(current.weathercode);
            weatherElements.desc.textContent = getWeatherDesc(current.weathercode);
            weatherElements.wind.textContent = `${current.windspeed} km/h`;
            weatherElements.humidity.textContent = 'Data N/A'; // OpenMeteo basic free doesn't give current humidity easily in one call without hourly

            const date = new Date();
            weatherElements.date.textContent = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }

        // 2. Render 7-Day Forecast Grid
        if (data.daily) {
            weatherElements.grid.innerHTML = '';
            for (let i = 1; i < data.daily.time.length; i++) { // Start from 1 (tomorrow)
                const dayDate = new Date(data.daily.time[i]);
                const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'short' });
                const code = data.daily.weathercode[i];
                const max = Math.round(data.daily.temperature_2m_max[i]);
                const min = Math.round(data.daily.temperature_2m_min[i]);

                const card = document.createElement('div');
                card.className = 'forecast-card';
                card.style.background = 'rgba(255,255,255,0.05)';
                card.style.padding = '15px';
                card.style.borderRadius = '12px';
                card.style.textAlign = 'center';

                card.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 5px; color: var(--text-secondary);">${dayName}</div>
                    <div style="font-size: 2rem; margin-bottom: 5px;">${getWeatherIcon(code)}</div>
                    <div>
                        <span style="font-weight: bold;">${max}°</span> 
                        <span style="color: var(--text-secondary); font-size: 0.9em;">${min}°</span>
                    </div>
                `;
                weatherElements.grid.appendChild(card);
            }
        }

    } catch (e) {
        console.error("Weather fetch failed", e);
        weatherElements.city.textContent = "Error loading data";
    }
}

async function searchCityWeather() {
    const city = weatherElements.input.value.trim();
    if (!city) return;

    try {
        // Geocoding
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        const geoData = await geoRes.json();

        if (geoData.results && geoData.results.length > 0) {
            const result = geoData.results[0];
            fetchWeather(result.latitude, result.longitude, result.name);
        } else {
            alert('City not found!');
        }
    } catch (e) {
        console.error(e);
        alert('Search failed.');
    }
}

// Listeners
document.getElementById('navWeather').addEventListener('click', (e) => {
    e.preventDefault();
    switchMode('weather');
});

weatherElements.btn.addEventListener('click', searchCityWeather);
weatherElements.input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchCityWeather();
});

function initWeather() {
    // Default to Erode, India
    fetchWeather(11.3410, 77.7172, "Erode");

    // Try to get user location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            fetchWeather(lat, lon, "Local Location");
        }, (err) => {
            console.log("Loc permission denied, using default (Erode)");
        });
    }
}


// --- Focus Mode Feature ---
let focusInterval;
let timeLeft = 25 * 60;
let isTimerRunning = false;
let brownNoiseNode = null;

const focusElements = {
    section: document.getElementById('focusSection'),
    timerDisplay: document.getElementById('focusTimer'),
    btnStart: document.getElementById('startTimerBtn'),
    btnReset: document.getElementById('resetTimerBtn'),
    modeBtns: document.querySelectorAll('.mode-btn'),
    btnBrownNoise: document.getElementById('btnBrownNoise'),
    btnLofi: document.getElementById('btnLofiFocus'),
    navFocus: document.getElementById('navFocus')
};

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function updateTimerDisplay() {
    focusElements.timerDisplay.textContent = formatTime(timeLeft);
    document.title = `${formatTime(timeLeft)} - Focus | StreamFlow`;
}

function startTimer() {
    if (isTimerRunning) return;
    isTimerRunning = true;
    focusElements.btnStart.innerHTML = '<i class="fa-solid fa-pause"></i> Pause';
    focusElements.btnStart.classList.add('active'); // Visual pulse if needed

    focusInterval = setInterval(() => {
        if (timeLeft > 0) {
            timeLeft--;
            updateTimerDisplay();
        } else {
            clearInterval(focusInterval);
            isTimerRunning = false;
            focusElements.btnStart.innerHTML = '<i class="fa-solid fa-play"></i> Start';
            // Play alarm sound (beeps)
            playSimpleBeep();
            alert("Session Complete!");
        }
    }, 1000);
}

function pauseTimer() {
    clearInterval(focusInterval);
    isTimerRunning = false;
    focusElements.btnStart.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
}

function resetTimer() {
    pauseTimer();
    const activeMode = document.querySelector('.mode-btn.active').dataset.mode;
    if (activeMode === 'focus') timeLeft = 25 * 60;
    else if (activeMode === 'short') timeLeft = 5 * 60;
    else if (activeMode === 'long') timeLeft = 15 * 60;

    updateTimerDisplay();
    focusElements.btnStart.innerHTML = '<i class="fa-solid fa-play"></i> Start';
    document.title = "StreamFlow - Live TV";
}

function playSimpleBeep() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

// Brown Noise Generator (Web Audio API)
function toggleBrownNoise() {
    if (brownNoiseNode) {
        // Stop
        brownNoiseNode.disconnect();
        brownNoiseNode = null;
        focusElements.btnBrownNoise.classList.remove('active');
    } else {
        // Start
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const bufferSize = 2 * ctx.sampleRate;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5; // Compensate for gain
        }

        const noiseSrc = ctx.createBufferSource();
        noiseSrc.buffer = buffer;
        noiseSrc.loop = true;

        // Filter to make it "Brown" / Warm
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1000;

        const gain = ctx.createGain();
        gain.gain.value = 0.5; // default volume

        noiseSrc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noiseSrc.start();

        brownNoiseNode = gain; // Store gain node to disconnect later
        focusElements.btnBrownNoise.classList.add('active');
    }
}
let lastOut = 0;

function initFocus() {
    // Timer Controls
    focusElements.btnStart.addEventListener('click', () => {
        if (isTimerRunning) pauseTimer();
        else startTimer();
    });

    focusElements.btnReset.addEventListener('click', resetTimer);

    // Mode Buttons
    focusElements.modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            focusElements.modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            resetTimer();
        });
    });

    // Sounds
    focusElements.btnBrownNoise.addEventListener('click', toggleBrownNoise);

    // Lofi Shortcut (Switches to Radio and searches for 'lofi')
    focusElements.btnLofi.addEventListener('click', () => {
        switchMode('radio');
        // Auto-search logic
        radioElements.radioGenre.value = 'pop'; // fallback or similar
        // Or trigger search manually
        // Note: We don't have a direct 'Lofi' genre in the dropdown but we can simulate search
        alert("Pro Tip: Search for 'Chill' or 'Lofi' in the Radio tab!");
    });

    // Nav Listener
    focusElements.navFocus.addEventListener('click', (e) => {
        e.preventDefault();
        switchMode('focus');
    });
}

// --- Global Chat Feature (MQTT) ---
let mqttClient;
const MQTT_BROKER = "broker.hivemq.com";
// Port will be determined dynamically
const MQTT_TOPIC = "streamflow/chat/global";
const CHAT_CLIENT_ID = "streamflow_user_" + Math.random().toString(16).substr(2, 8);

const chatElements = {
    section: document.getElementById('chatSection'),
    messages: document.getElementById('chatMessages'),
    inputNick: document.getElementById('chatNickInput'),
    inputMsg: document.getElementById('chatMsgInput'),
    btnSend: document.getElementById('sendMsgBtn'),
    status: document.getElementById('connectionStatus'),
    navChat: document.getElementById('navChat')
};

function initChat() {
    // 1. Determine Port (WSS vs WS)
    const isSecure = window.location.protocol === "https:";
    const port = isSecure ? 8884 : 8000;

    console.log(`Initializing Chat: ${isSecure ? 'Secure (WSS)' : 'Insecure (WS)'} on port ${port}`);

    // 2. Setup Client
    // @ts-ignore
    mqttClient = new Paho.MQTT.Client(MQTT_BROKER, port, CHAT_CLIENT_ID);

    // 3. Callbacks
    mqttClient.onConnectionLost = onConnectionLost;
    mqttClient.onMessageArrived = onMessageArrived;

    // 4. Connect
    connectToChat(isSecure);

    // 5. Listeners
    chatElements.btnSend.addEventListener('click', sendChatMessage);
    chatElements.inputMsg.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    chatElements.navChat.addEventListener('click', (e) => {
        e.preventDefault();
        switchMode('chat');
        if (!mqttClient.isConnected()) connectToChat(window.location.protocol === "https:");
        scrollToBottom();
    });
}

function connectToChat(useSSL) {
    chatElements.status.textContent = "Connecting...";
    chatElements.status.className = "status-badge connecting";

    mqttClient.connect({
        onSuccess: onConnect,
        onFailure: (e) => {
            console.error("MQTT Connect Failed", e);
            chatElements.status.textContent = "Offline (Click to Retry)";
            chatElements.status.className = "status-badge disconnected";
            chatElements.status.onclick = () => connectToChat(window.location.protocol === "https:");
        },
        useSSL: useSSL,
        keepAliveInterval: 30
    });
}

function onConnect() {
    console.log("MQTT Connected");
    chatElements.status.textContent = "Online";
    chatElements.status.className = "status-badge connected";

    // Subscribe
    mqttClient.subscribe(MQTT_TOPIC);
}

function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
        console.log("MQTT Connection Lost: " + responseObject.errorMessage);
        chatElements.status.textContent = "Disconnected";
        chatElements.status.className = "status-badge disconnected";
    }
}

function onMessageArrived(message) {
    try {
        const payload = JSON.parse(message.payloadString);
        renderMessage(payload.nick, payload.text, payload.senderId === CHAT_CLIENT_ID);
    } catch (e) {
        console.error("Invalid msg format", e);
    }
}

function sendChatMessage() {
    const text = chatElements.inputMsg.value.trim();
    const nick = chatElements.inputNick.value.trim() || "Anonymous";

    if (!text) return;
    if (!mqttClient.isConnected()) {
        alert("Not connected to chat server!");
        connectToChat();
        return;
    }

    const payload = {
        senderId: CHAT_CLIENT_ID,
        nick: nick,
        text: text,
        timestamp: Date.now()
    };

    const message = new Paho.MQTT.Message(JSON.stringify(payload));
    message.destinationName = MQTT_TOPIC;
    mqttClient.send(message);

    chatElements.inputMsg.value = "";
}

function renderMessage(nick, text, isSelf) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${isSelf ? 'self' : 'other'}`;

    msgDiv.innerHTML = `
        <span class="msg-sender">${escapeHtml(nick)}</span>
        <span class="msg-content">${escapeHtml(text)}</span>
    `;

    chatElements.messages.appendChild(msgDiv);
    scrollToBottom();
}

function scrollToBottom() {
    chatElements.messages.scrollTop = chatElements.messages.scrollHeight;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


initApp();
initWeather();
initFocus();
initChat();
