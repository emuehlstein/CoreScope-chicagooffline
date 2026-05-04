/**
 * globe.js — 3D Globe view for MeshCore network
 * Uses Cesium for 3D visualization of nodes and packet paths
 */

'use strict';

(function() {
  let viewer;
  let nodeEntities = new Map();
  let nodeData = new Map(); // Store node info by public_key
  let wsHandler;
  let statsDiv;
  let pulseInterval;
  
  // VCR replay state
  const VCR = {
    mode: 'LIVE',        // LIVE | REPLAY
    buffer: [],          // Fetched historical packets
    playhead: 0,         // Current index in buffer
    speed: 1,            // Replay speed: 1, 2, 4, 8
    timer: null,         // Replay interval timer
    isPlaying: false
  };

  // Initialize Cesium viewer
  async function initViewer(container) {
    // Cesium Ion access token
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhZjMzYTczNS03YTlkLTRkOWItYjI1Zi02YjJhNjBmNjYxNjgiLCJpZCI6NDI2ODYzLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzc4NDY5NDl9.-m7FPQsB4syRZQn6mt2WZ7jffejFyk1twYRTBFe-7BA';

    // Create viewer with Cesium Ion imagery and base layer picker
    viewer = new Cesium.Viewer(container, {
      baseLayerPicker: true,  // Enable layer picker for Cesium Ion basemaps
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      infoBox: true,
      selectionIndicator: true
    });

    // Ensure globe is visible
    viewer.scene.globe.show = true;
    viewer.scene.skyBox.show = true;
    viewer.scene.sun.show = true;
    viewer.scene.moon.show = false;

    console.log('[globe] Viewer created, globe.show:', viewer.scene.globe.show);

    // Set initial camera position over Lake Michigan looking west at Chicago
    // Further east over the lake, lower altitude, more horizontal view
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-86.9, 41.88, 5000000), // Further east over lake
      orientation: {
        heading: Cesium.Math.toRadians(270), // Point west toward Chicago
        pitch: Cesium.Math.toRadians(-50), // Less steep initial angle
        roll: 0
      }
    });

    console.log('[globe] Camera positioned over Lake Michigan (further east), distance:', Cesium.Cartesian3.magnitude(viewer.camera.position));

    // Fly to lower, more horizontal view
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-86.9, 41.88, 18000), // Lower altitude (18km)
        orientation: {
          heading: Cesium.Math.toRadians(270), // Looking west at Chicago
          pitch: Cesium.Math.toRadians(-20), // More horizontal viewing angle
          roll: 0
        },
        duration: 3
      });
    }, 500);

    // Enable depth testing for better 3D visualization
    viewer.scene.globe.depthTestAgainstTerrain = true;

    // Add hillshade terrain layer from tiles.chicagooffline.com
    // Use dark hillshade (better contrast on satellite imagery)
    console.log('[globe] Attempting to add hillshade layer...');
    try {
      const hillshadeProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.chicagooffline.com/services/cook-hillshade-combined-dark-9x/tiles/{z}/{x}/{y}.png',
        maximumLevel: 14,
        credit: '© Chicago Offline — 3DEP+LiDAR Hillshade',
        tilingScheme: new Cesium.WebMercatorTilingScheme()
      });
      
      // Wait for provider to be ready
      await hillshadeProvider.readyPromise;
      console.log('[globe] Hillshade provider ready:', {
        ready: hillshadeProvider.ready,
        rectangle: hillshadeProvider.rectangle,
        tileWidth: hillshadeProvider.tileWidth,
        tileHeight: hillshadeProvider.tileHeight
      });
      
      const hillshadeLayer = viewer.imageryLayers.addImageryProvider(hillshadeProvider);
      hillshadeLayer.alpha = 0.6; // Semi-transparent for blending with base map
      hillshadeLayer.brightness = 1.0; // Normal brightness
      hillshadeLayer.contrast = 1.3; // Increase contrast for visibility
      hillshadeLayer.show = true;
      
      console.log('[globe] ✓ Hillshade layer added:', {
        url: hillshadeProvider.url,
        alpha: hillshadeLayer.alpha,
        brightness: hillshadeLayer.brightness,
        show: hillshadeLayer.show,
        layerIndex: viewer.imageryLayers.indexOf(hillshadeLayer),
        totalLayers: viewer.imageryLayers.length
      });
      
      // Log tile requests
      hillshadeProvider.errorEvent.addEventListener((error) => {
        console.error('[globe] Hillshade tile error:', error);
      });
      
    } catch (err) {
      console.error('[globe] ✗ Failed to load hillshade layer:', err);
      console.error('[globe] Error details:', err.message, err.stack);
    }

    console.log('[globe] Cesium viewer initialized');
  }

  // Fetch and display nodes
  async function loadNodes() {
    try {
      console.log('[globe] Fetching nodes from /api/nodes...');
      const response = await fetch('/api/nodes');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[globe] Raw API response type:', Array.isArray(data) ? 'array' : 'object');
      console.log('[globe] Raw API response keys:', Object.keys(data));
      
      // Handle both array and object responses
      const nodes = Array.isArray(data) ? data : (data.nodes || []);
      
      if (!Array.isArray(nodes)) {
        throw new Error(`Expected nodes array, got ${typeof nodes}`);
      }
      
      console.log(`[globe] Processing ${nodes.length} nodes...`);
      
      let plotted = 0;
      let skipped = 0;
      nodes.forEach((node, index) => {
        if (node.lat && node.lon) {
          addNodeToGlobe(node);
          // Store node data for pulse lookups
          nodeData.set(node.public_key || node.id, {
            lat: node.lat,
            lon: node.lon,
            name: node.name
          });
          plotted++;
          if (index < 5) {
            console.log(`  [${index}] ✓ ${node.name || node.id} at ${node.lat}, ${node.lon}`);
          }
        } else {
          skipped++;
          if (index < 5 || skipped < 3) {
            console.warn(`  [${index}] ✗ ${node.name || node.id} - no coordinates`);
          }
        }
      });
      
      console.log(`[globe] ✓ Loaded ${plotted} nodes, ${skipped} skipped (no coords)`);
      console.log(`[globe] Total entities in viewer: ${viewer.entities.values.length}`);
      updateStats();
    } catch (err) {
      console.error('[globe] ✗ Failed to load nodes:', err);
      console.error('[globe] Error stack:', err.stack);
    }
  }
  
  // Add test markers to verify the globe is working
  function addTestMarker() {
    // Add several highly visible test nodes in Chicago area
    const testNodes = [
      { id: 'test-downtown', name: '🔴 TEST Downtown', lat: 41.8781, lon: -87.6298, lastSeenAt: new Date().toISOString() },
      { id: 'test-northside', name: '🔴 TEST North', lat: 41.95, lon: -87.65, lastSeenAt: new Date().toISOString() },
      { id: 'test-southside', name: '🔴 TEST South', lat: 41.80, lon: -87.60, lastSeenAt: new Date().toISOString() },
      { id: 'test-west', name: '🔴 TEST West', lat: 41.88, lon: -87.75, lastSeenAt: new Date().toISOString() },
      { id: 'test-evanston', name: '🔴 TEST Evanston', lat: 42.05, lon: -87.68, lastSeenAt: new Date().toISOString() }
    ];
    
    console.log('[globe] Adding test markers at:');
    testNodes.forEach(node => {
      console.log(`  - ${node.name}: ${node.lat}, ${node.lon}`);
      addNodeToGlobe(node);
    });
    updateStats();
    console.log(`[globe] ✓ Added ${testNodes.length} test markers`);
  }

  // Add a node marker to the globe
  function addNodeToGlobe(node) {
    try {
      const position = Cesium.Cartesian3.fromDegrees(node.lon, node.lat, 0); // At ground level
      
      // Color based on activity (green = recent, amber = old, grey = inactive)
      const lastSeen = node.last_seen ? new Date(node.last_seen) : null;
      const ageMinutes = lastSeen ? (Date.now() - lastSeen.getTime()) / 60000 : Infinity;
      
      let color;
      if (ageMinutes < 60) {
        color = Cesium.Color.fromCssColorString('#39FF14'); // Mesh Green
      } else if (ageMinutes < 1440) {
        color = Cesium.Color.fromCssColorString('#FFB300'); // Beacon Amber
      } else {
        color = Cesium.Color.fromCssColorString('#6B7280'); // Grey
      }

      // Simple, highly visible point marker
      const entity = viewer.entities.add({
        id: `node-${node.public_key}`,
        position: position,
        point: {
          pixelSize: 24, // Large visible point
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 4,
          scaleByDistance: new Cesium.NearFarScalar(1000, 2.0, 100000, 0.5) // Scale based on distance
        },
        label: {
          text: node.name || node.public_key,
          font: 'bold 18px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -30),
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1000, 1.5, 100000, 0.5)
        },
        description: `
          <div style="font-family: sans-serif;">
            <h3 style="margin: 0 0 10px 0;">${node.name || node.public_key}</h3>
            <p style="margin: 5px 0;"><strong>ID:</strong> ${node.public_key}</p>
            <p style="margin: 5px 0;"><strong>Location:</strong> ${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}</p>
            <p style="margin: 5px 0;"><strong>Last Seen:</strong> ${lastSeen ? lastSeen.toLocaleString() : 'Never'}</p>
            ${node.role ? `<p style="margin: 5px 0;"><strong>Role:</strong> ${node.role}</p>` : ''}
          </div>
        `
      });

      nodeEntities.set(node.public_key, entity);
      console.log(`[globe] ✓ Added node: ${node.name || node.public_key} at ${node.lat}, ${node.lon}`);
    } catch (err) {
      console.error(`[globe] ✗ Failed to add node ${node.public_key}:`, err);
    }
  }

  // Update node stats display
  function updateStats() {
    if (!statsDiv) return;
    
    const total = nodeEntities.size;
    const active = Array.from(nodeEntities.values()).filter(e => {
      const color = e.point.color.getValue();
      return color.equals(Cesium.Color.fromCssColorString('#39FF14'));
    }).length;
    
    const paths = packetPaths.size;

    statsDiv.innerHTML = `
      <span class="globe-stats-label">Nodes:</span>
      <span class="globe-stats-value">${total}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Active:</span>
      <span class="globe-stats-value">${active}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Paths:</span>
      <span class="globe-stats-value">${paths}</span>
    `;
  }

  // Update an existing node or add if new
  function updateNode(node) {
    if (!node.lat || !node.lon) return;
    
    const existing = nodeEntities.get(node.public_key);
    if (existing) {
      // Update existing node (color based on recent activity)
      existing.point.color = Cesium.Color.fromCssColorString('#39FF14'); // Mesh Green
      updateStats();
    } else {
      // Add new node
      addNodeToGlobe(node);
      updateStats();
    }
  }

  // Pulse a node when a packet involves it
  function pulseNode(publicKey) {
    const entity = nodeEntities.get(publicKey);
    if (!entity) {
      // Node not on globe yet, skip pulse
      return;
    }
    
    const originalSize = 8;
    const pulseSize = 16;
    const originalColor = Cesium.Color.fromCssColorString('#39FF14'); // Mesh Green
    const pulseColor = Cesium.Color.fromCssColorString('#FFB300'); // Beacon Amber
    
    // Pulse effect: grow and change color
    entity.point.pixelSize = pulseSize;
    entity.point.color = pulseColor;
    
    // Return to normal after 300ms
    setTimeout(() => {
      entity.point.pixelSize = originalSize;
      entity.point.color = originalColor;
    }, 300);
  }

  // VCR Functions
  async function fetchHistoricalPackets() {
    try {
      const since = new Date(Date.now() - 3600000).toISOString(); // Last 1 hour
      console.log('[globe] Fetching historical packets since', since);
      const response = await fetch(`/api/packets?limit=1000&grouped=false&expand=observations&since=${encodeURIComponent(since)}&order=asc`);
      const data = await response.json();
      const packets = data.packets || [];
      
      VCR.buffer = packets.map(pkt => ({
        ts: new Date(pkt.created_at || pkt.timestamp).getTime(),
        packet: pkt
      }));
      
      console.log(`[globe] Loaded ${VCR.buffer.length} historical packets`);
      updateVCRUI();
    } catch (err) {
      console.error('[globe] Failed to fetch historical packets:', err);
    }
  }

  function startReplay() {
    console.log('[globe] startReplay() called, buffer length:', VCR.buffer.length);
    
    if (VCR.buffer.length === 0) {
      console.log('[globe] No packets in buffer, fetching...');
      fetchHistoricalPackets().then(() => {
        console.log('[globe] Fetch complete, restarting replay...');
        if (VCR.buffer.length > 0) {
          startReplay();
        }
      });
      return;
    }
    
    console.log('[globe] Starting replay with', VCR.buffer.length, 'packets');
    VCR.mode = 'REPLAY';
    VCR.isPlaying = true;
    VCR.playhead = 0;
    updateVCRUI();
    
    try {
      replayStep();
    } catch (err) {
      console.error('[globe] Replay error:', err);
    }
  }

  function stopReplay() {
    VCR.isPlaying = false;
    if (VCR.timer) {
      clearTimeout(VCR.timer);
      VCR.timer = null;
    }
    updateVCRUI();
  }

  function replayStep() {
    if (!VCR.isPlaying || VCR.playhead >= VCR.buffer.length) {
      // End of buffer
      VCR.mode = 'LIVE';
      VCR.isPlaying = false;
      VCR.playhead = 0;
      updateVCRUI();
      console.log('[globe] Replay complete');
      return;
    }
    
    const entry = VCR.buffer[VCR.playhead];
    const pkt = entry.packet;
    
    // Debug: log packet structure on first packet
    if (VCR.playhead === 0) {
      console.log('[globe] First packet structure:', {
        keys: Object.keys(pkt),
        from: pkt.from,
        to: pkt.to,
        source: pkt.source,
        destination: pkt.destination,
        hops: pkt.hops,
        observations: pkt.observations
      });
    }
    
    // Try different field names (API uses source/destination, not from/to)
    const from = pkt.from || pkt.source;
    const to = pkt.to || pkt.destination;
    
    // Pulse nodes for this packet
    if (from) {
      console.log(`[globe] Pulsing source: ${from}`);
      pulseNode(from);
    }
    if (to) {
      console.log(`[globe] Pulsing destination: ${to}`);
      pulseNode(to);
    }
    
    // Check observations array for hops
    const hops = pkt.hops || pkt.observations || [];
    if (hops.length > 0) {
      console.log(`[globe] Processing ${hops.length} hops/observations`);
      hops.forEach(hop => {
        const hopNode = hop.node || hop.observer_id || hop.observerId;
        if (hopNode) {
          console.log(`[globe] Pulsing hop: ${hopNode}`);
          pulseNode(hopNode);
        }
      });
    }
    
    VCR.playhead++;
    updateVCRUI();
    
    // Calculate delay to next packet (realistic timing) or use fixed interval
    let delay = 500 / VCR.speed; // Default 500ms between packets, adjusted by speed
    
    if (VCR.playhead < VCR.buffer.length) {
      const nextEntry = VCR.buffer[VCR.playhead];
      const realDelay = (nextEntry.ts - entry.ts) / VCR.speed;
      if (realDelay > 0 && realDelay < 5000) { // Cap at 5s per step
        delay = realDelay;
      }
    }
    
    VCR.timer = setTimeout(replayStep, delay);
  }

  function cycleSpeed() {
    const speeds = [1, 2, 4, 8];
    const idx = speeds.indexOf(VCR.speed);
    VCR.speed = speeds[(idx + 1) % speeds.length];
    updateVCRUI();
  }

  function updateVCRUI() {
    const playBtn = document.getElementById('vcrPlay');
    const pauseBtn = document.getElementById('vcrPause');
    const speedBtn = document.getElementById('vcrSpeed');
    const statusSpan = document.getElementById('vcrStatus');
    const progressSpan = document.getElementById('vcrProgress');
    
    if (!playBtn || !pauseBtn || !speedBtn || !statusSpan || !progressSpan) return;
    
    if (VCR.isPlaying) {
      playBtn.style.display = 'none';
      pauseBtn.style.display = 'inline-block';
      statusSpan.textContent = 'REPLAY';
      statusSpan.style.color = '#FFB300';
    } else {
      playBtn.style.display = 'inline-block';
      pauseBtn.style.display = 'none';
      statusSpan.textContent = VCR.mode;
      statusSpan.style.color = VCR.mode === 'LIVE' ? '#39FF14' : '#A0AABF';
    }
    
    speedBtn.textContent = `${VCR.speed}x`;
    
    if (VCR.buffer.length > 0) {
      progressSpan.textContent = `${VCR.playhead}/${VCR.buffer.length}`;
    } else {
      progressSpan.textContent = 'No packets loaded';
    }
  }

  // Initialize the page
  async function init(app, routeParam) {
    app.innerHTML = `
      <div id="globeContainer"></div>
      <div class="globe-stats" id="globeStats">Loading...</div>
      <div class="globe-vcr" id="globeVCR" style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: white; padding: 12px 20px; border-radius: 8px; font-family: monospace; font-size: 14px; z-index: 1000; display: flex; gap: 12px; align-items: center;">
        <button id="vcrPlay" style="background: #39FF14; color: #000; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;">▶ Play</button>
        <button id="vcrPause" style="background: #FFB300; color: #000; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; display: none;">⏸ Pause</button>
        <button id="vcrSpeed" style="background: #444; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">1x</button>
        <span id="vcrStatus" style="color: #A0AABF;">LIVE</span>
        <span id="vcrProgress" style="color: #00E5FF;"></span>
      </div>
    `;

    const container = document.getElementById('globeContainer');
    statsDiv = document.getElementById('globeStats');

    if (typeof Cesium === 'undefined') {
      app.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text);">Cesium library failed to load. Please refresh the page.</div>';
      console.error('[globe] Cesium library not loaded');
      return;
    }

    await initViewer(container);
    
    // Add test markers immediately for debugging
    console.log('[globe] === INITIALIZATION STARTING ===');
    console.log('[globe] Adding test markers...');
    addTestMarker();
    console.log(`[globe] Test markers added, total entities: ${viewer.entities.values.length}`);
    
    // Load real nodes
    console.log('[globe] Starting loadNodes()...');
    loadNodes().then(() => {
      console.log('[globe] === loadNodes() completed ===');
      console.log(`[globe] Final entity count: ${viewer.entities.values.length}`);
    }).catch(err => {
      console.error('[globe] === loadNodes() FAILED ===', err);
    });
    
    // Load packet paths after nodes (so we have node positions)
    setTimeout(() => {
      loadPacketPaths();
    }, 2000);

    // Set up WebSocket handler for real-time updates
    wsHandler = function (msg) {
      if (msg.type === 'node' && msg.node) {
        updateNode(msg.node);
      } else if (msg.type === 'packet' && msg.packet) {
        // Pulse nodes on packet arrival
        const { from, to, hops } = msg.packet;
        
        // Pulse source node
        if (from) pulseNode(from);
        
        // Pulse destination node
        if (to) pulseNode(to);
        
        // Pulse intermediate hops
        if (hops && hops.length > 0) {
          hops.forEach(hop => {
            if (hop.node) pulseNode(hop.node);
          });
        }
        
        console.log('[globe] Packet pulses:', {
          from, to, hops: hops?.length || 0
        });
      }
    };
    if (window.registerWSHandler) {
      registerWSHandler(wsHandler);
    }
    
    // Wire up VCR controls
    document.getElementById('vcrPlay').addEventListener('click', () => {
      console.log('[globe] Play button clicked');
      startReplay();
    });
    document.getElementById('vcrPause').addEventListener('click', () => {
      console.log('[globe] Pause button clicked');
      stopReplay();
    });
    document.getElementById('vcrSpeed').addEventListener('click', () => {
      console.log('[globe] Speed button clicked');
      cycleSpeed();
    });
    
    // Fetch historical packets for replay
    fetchHistoricalPackets();
    
    // Periodic pulse animation on recent paths (visual heartbeat)
    pulseInterval = setInterval(() => {
      // Find paths from last 2 minutes and randomly pulse one
      const recentPaths = Array.from(packetPaths.entries())
        .filter(([id, entity]) => {
          // Check if path has description with timestamp
          return entity.description; // Simple check
        })
        .slice(0, 5); // Take up to 5 most recent
      
      if (recentPaths.length > 0) {
        const randomPath = recentPaths[Math.floor(Math.random() * recentPaths.length)][1];
        if (randomPath.polyline && randomPath.polyline.positions) {
          const positions = randomPath.polyline.positions.getValue(Cesium.JulianDate.now());
          if (positions && positions.length >= 2) {
            const pulseColor = Cesium.Color.fromCssColorString('#00E5FF').withAlpha(0.8);
            addPulseAlongPath(positions, pulseColor);
          }
        }
      }
    }, 5000); // Every 5 seconds
  }

  // Cleanup when leaving the page
  function destroy() {
    if (pulseInterval) {
      clearInterval(pulseInterval);
      pulseInterval = null;
    }
    if (VCR.timer) {
      clearTimeout(VCR.timer);
      VCR.timer = null;
    }
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    nodeEntities.clear();
    nodeData.clear();
    packetPaths.clear();
    VCR.buffer = [];
    VCR.playhead = 0;
    VCR.isPlaying = false;
    if (wsHandler && window.unregisterWSHandler) {
      unregisterWSHandler(wsHandler);
      wsHandler = null;
    }
    statsDiv = null;
  }

  // Register the page
  registerPage('globe', {
    init: init,
    destroy: destroy
  });

})();

  // Store packet paths
  let packetPaths = new Map();

  // Fetch and display recent packet paths
  async function loadPacketPaths() {
    try {
      console.log('[globe] Fetching recent packets...');
      const response = await fetch('/api/packets?limit=100');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      const packets = Array.isArray(data) ? data : (data.packets || []);
      
      console.log(`[globe] Loaded ${packets.length} packets`);
      
      let pathsAdded = 0;
      packets.forEach(packet => {
        if (packet.path && packet.path.length >= 2) {
          addPacketPath(packet);
          pathsAdded++;
        }
      });
      
      console.log(`[globe] Added ${pathsAdded} packet paths`);
    } catch (err) {
      console.error('[globe] Failed to load packets:', err);
    }
  }

  // Add a packet path polyline
  function addPacketPath(packet) {
    if (!packet.path || packet.path.length < 2) return;
    
    const pathId = `path-${packet.id}`;
    
    // Remove old path if exists
    if (packetPaths.has(pathId)) {
      viewer.entities.remove(packetPaths.get(pathId));
    }
    
    // Build positions array from path hops
    const positions = [];
    packet.path.forEach(hop => {
      // Look up node coordinates
      const nodeEntity = viewer.entities.getById(`node-${hop.id || hop}`);
      if (nodeEntity && nodeEntity.position) {
        positions.push(nodeEntity.position.getValue(Cesium.JulianDate.now()));
      }
    });
    
    if (positions.length < 2) return;
    
    // Calculate age for color
    const age = packet.timestamp ? (Date.now() - new Date(packet.timestamp).getTime()) / 1000 : Infinity;
    
    // Color based on age (fade from cyan to grey)
    let color;
    if (age < 60) {
      color = Cesium.Color.fromCssColorString('#00E5FF').withAlpha(0.8); // Signal Cyan
    } else if (age < 600) {
      color = Cesium.Color.fromCssColorString('#FFB300').withAlpha(0.6); // Beacon Amber
    } else {
      color = Cesium.Color.fromCssColorString('#6B7280').withAlpha(0.4); // Grey
    }
    
    // Create polyline entity with arc
    const entity = viewer.entities.add({
      id: pathId,
      polyline: {
        positions: positions,
        width: 3,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3,
          color: color
        }),
        arcType: Cesium.ArcType.GEODESIC,
        clampToGround: false
      },
      description: `
        <div style="font-family: sans-serif;">
          <h3 style="margin: 0 0 10px 0;">Packet Path</h3>
          <p style="margin: 5px 0;"><strong>Hops:</strong> ${packet.path.length}</p>
          <p style="margin: 5px 0;"><strong>Route:</strong> ${packet.path.map(h => h.id || h).join(' → ')}</p>
          ${packet.timestamp ? `<p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(packet.timestamp).toLocaleString()}</p>` : ''}
          ${packet.snr ? `<p style="margin: 5px 0;"><strong>SNR:</strong> ${packet.snr} dB</p>` : ''}
        </div>
      `
    });
    
    packetPaths.set(pathId, entity);
    
    // Trigger animated pulse for fresh packets (< 30 seconds old)
    if (age < 30) {
      const pulseColor = Cesium.Color.fromCssColorString('#00E5FF'); // Signal Cyan
      addPulseAlongPath(positions, pulseColor);
      console.log(`[globe] Animating pulse for fresh packet ${packet.id}`);
    }
    
    // Auto-fade after 10 minutes
    setTimeout(() => {
      if (packetPaths.has(pathId)) {
        viewer.entities.remove(packetPaths.get(pathId));
        packetPaths.delete(pathId);
      }
    }, 600000);
  }

  // Add animated pulse along a path (hop by hop)
  function addPulseAlongPath(positions, color, delayMs = 0) {
    if (positions.length < 2) return;
    
    // Animate pulse for each hop in sequence
    positions.forEach((pos, i) => {
      if (i === positions.length - 1) return; // Skip last (no next hop)
      
      const fromPos = positions[i];
      const toPos = positions[i + 1];
      const hopDelay = delayMs + (i * 800); // Stagger hops by 800ms
      
      setTimeout(() => {
        animatePulse(fromPos, toPos, color);
      }, hopDelay);
    });
  }
  
  // Animate a single pulse between two positions
  function animatePulse(fromPos, toPos, color) {
    const startTime = Cesium.JulianDate.now();
    const stopTime = Cesium.JulianDate.addSeconds(startTime, 0.8, new Cesium.JulianDate());
    
    // Create moving point
    const pulse = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startTime, stop: stopTime })
      ]),
      position: new Cesium.SampledPositionProperty(),
      point: {
        pixelSize: 12,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3
      },
      ellipsoid: {
        radii: new Cesium.Cartesian3(50, 50, 50),
        material: color.withAlpha(0.5)
      }
    });
    
    // Animate from source to destination
    pulse.position.addSample(startTime, fromPos);
    pulse.position.addSample(stopTime, toPos);
    
    // Auto-remove after animation
    setTimeout(() => {
      viewer.entities.remove(pulse);
    }, 1000);
  }
