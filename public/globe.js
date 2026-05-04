/**
 * globe.js — 3D Globe view for MeshCore network
 * Uses Cesium for 3D visualization of nodes and packet paths
 */

'use strict';

(function() {
  let viewer;
  let nodeEntities = new Map();
  let wsHandler;
  let statsDiv;
  let pulseInterval;

  // Initialize Cesium viewer
  function initViewer(container) {
    // Cesium Ion access token
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhZjMzYTczNS03YTlkLTRkOWItYjI1Zi02YjJhNjBmNjYxNjgiLCJpZCI6NDI2ODYzLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzc4NDY5NDl9.-m7FPQsB4syRZQn6mt2WZ7jffejFyk1twYRTBFe-7BA';

    // Create viewer with Cesium Ion imagery (Bing Maps satellite)
    viewer = new Cesium.Viewer(container, {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: true,
      infoBox: true,
      selectionIndicator: true,
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
    try {
      const hillshadeProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.chicagooffline.com/services/cook-hillshade-combined-dark-9x/tiles/{z}/{x}/{y}.png',
        maximumLevel: 14,
        credit: '© Chicago Offline — 3DEP+LiDAR Hillshade',
        tilingScheme: new Cesium.WebMercatorTilingScheme()
      });
      
      const hillshadeLayer = viewer.imageryLayers.addImageryProvider(hillshadeProvider);
      hillshadeLayer.alpha = 0.8; // Increased to 80% for better visibility
      hillshadeLayer.brightness = 1.2; // Boost brightness slightly
      
      console.log('[globe] Hillshade layer added:', {
        url: hillshadeProvider.url,
        alpha: hillshadeLayer.alpha,
        layerIndex: viewer.imageryLayers.indexOf(hillshadeLayer),
        totalLayers: viewer.imageryLayers.length
      });
    } catch (err) {
      console.error('[globe] Failed to load hillshade layer:', err);
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
      const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt) : null;
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
        id: `node-${node.id}`,
        position: position,
        point: {
          pixelSize: 24, // Large visible point
          color: color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 4,
          scaleByDistance: new Cesium.NearFarScalar(1000, 2.0, 100000, 0.5) // Scale based on distance
        },
        label: {
          text: node.name || node.id,
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
            <h3 style="margin: 0 0 10px 0;">${node.name || node.id}</h3>
            <p style="margin: 5px 0;"><strong>ID:</strong> ${node.id}</p>
            <p style="margin: 5px 0;"><strong>Location:</strong> ${node.lat.toFixed(6)}, ${node.lon.toFixed(6)}</p>
            <p style="margin: 5px 0;"><strong>Last Seen:</strong> ${lastSeen ? lastSeen.toLocaleString() : 'Never'}</p>
            ${node.hardwareModel ? `<p style="margin: 5px 0;"><strong>Hardware:</strong> ${node.hardwareModel}</p>` : ''}
            ${node.role ? `<p style="margin: 5px 0;"><strong>Role:</strong> ${node.role}</p>` : ''}
          </div>
        `
      });

      nodeEntities.set(node.id, entity);
      console.log(`[globe] ✓ Added node: ${node.name || node.id} at ${node.lat}, ${node.lon}`);
    } catch (err) {
      console.error(`[globe] ✗ Failed to add node ${node.id}:`, err);
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
    
    const existing = nodeEntities.get(node.id);
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

  // Initialize the page
  function init(app, routeParam) {
    app.innerHTML = `
      <div id="globeContainer"></div>
      <div class="globe-stats" id="globeStats">Loading...</div>
    `;

    const container = document.getElementById('globeContainer');
    statsDiv = document.getElementById('globeStats');

    if (typeof Cesium === 'undefined') {
      app.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text);">Cesium library failed to load. Please refresh the page.</div>';
      console.error('[globe] Cesium library not loaded');
      return;
    }

    initViewer(container);
    
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
        // Add new packet path in real-time
        addPacketPath(msg.packet);
      }
    };
    if (window.registerWSHandler) {
      registerWSHandler(wsHandler);
    }
    
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
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    nodeEntities.clear();
    packetPaths.clear();
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
