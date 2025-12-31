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

initApp();
