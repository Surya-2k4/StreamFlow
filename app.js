const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';

const elements = {
    video: document.getElementById('video'),
    videoContainer: document.getElementById('videoContainer'),
    playerPlaceholder: document.getElementById('playerPlaceholder'),
    channelsGrid: document.getElementById('channelsGrid'),
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

        // Setup Infinite Scroll (Window scroll now)
        window.addEventListener('scroll', handleScroll);

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

    if (Hls.isSupported()) {
        if (hls) hls.destroy();
        hls = new Hls();
        hls.loadSource(channel.url);
        hls.attachMedia(elements.video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            elements.video.play().catch(e => console.log('Auto-play blocked:', e));
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.error('HLS Error:', data);
            }
        });
    } else if (elements.video.canPlayType('application/vnd.apple.mpegurl')) {
        elements.video.src = channel.url;
        elements.video.addEventListener('loadedmetadata', () => {
            elements.video.play();
        });
    }
}

function handleScroll() {
    // Check window scroll position
    if ((window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 500) {
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
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Reset scroll on search
});

initApp();
