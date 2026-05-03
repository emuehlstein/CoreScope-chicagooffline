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

    // Set initial camera position to look at Earth from above Chicago
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-87.6298, 41.8781, 10000000), // Start far out
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO, // Look straight down
        roll: 0
      }
    });

    console.log('[globe] Camera positioned, distance:', Cesium.Cartesian3.magnitude(viewer.camera.position));

    // Fly closer after a short delay
    setTimeout(() => {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(-87.6298, 41.8781, 50000),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-45),
          roll: 0
        },
        duration: 3
      });
    }, 500);

    // Enable depth testing for better 3D visualization
    viewer.scene.globe.depthTestAgainstTerrain = true;

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
      console.log('[globe] Raw API response:', data);
      
      // Handle both array and object responses
      const nodes = Array.isArray(data) ? data : (data.nodes || []);
      
      console.log(`[globe] Parsed ${nodes.length} nodes`);
      
      let plotted = 0;
      nodes.forEach(node => {
        if (node.lat && node.lon) {
          console.log(`[globe] Plotting node: ${node.id || node.name} at ${node.lat}, ${node.lon}`);
          addNodeToGlobe(node);
          plotted++;
        } else {
          console.warn('[globe] Node missing coordinates:', node);
        }
      });
      
      console.log(`[globe] Plotted ${plotted}/${nodes.length} nodes`);
      updateStats();
      
      // If no nodes, add a test marker at Chicago
      if (plotted === 0) {
        console.warn('[globe] No nodes plotted - adding test marker');
        addTestMarker();
      }
    } catch (err) {
      console.error('[globe] Failed to load nodes:', err);
      // Add test marker on error
      addTestMarker();
    }
  }
  
  // Add a test marker to verify the globe is working
  function addTestMarker() {
    const testNode = {
      id: 'test-marker',
      name: 'Test Node (Chicago)',
      lat: 41.8781,
      lon: -87.6298,
      lastSeenAt: new Date().toISOString()
    };
    addNodeToGlobe(testNode);
    updateStats();
    console.log('[globe] Added test marker at Chicago');
  }

  // Add a node marker to the globe
  function addNodeToGlobe(node) {
    const position = Cesium.Cartesian3.fromDegrees(node.lon, node.lat, 100); // 100m above ground for visibility
    
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

    const entity = viewer.entities.add({
      id: `node-${node.id}`,
      position: position,
      billboard: {
        image: createNodeMarker(color),
        width: 32,
        height: 32,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM
      },
      point: {
        pixelSize: 16,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND
      },
      label: {
        text: node.name || node.id,
        font: 'bold 16px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        show: true, // Always show labels
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000) // Hide when too far
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
  }

  // Create a colored marker canvas for billboards
  function createNodeMarker(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    
    // Draw circle
    ctx.beginPath();
    ctx.arc(16, 16, 12, 0, 2 * Math.PI);
    ctx.fillStyle = color.toCssColorString();
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
    
    return canvas;
  }

  // Update node stats display
  function updateStats() {
    if (!statsDiv) return;
    
    const total = nodeEntities.size;
    const active = Array.from(nodeEntities.values()).filter(e => {
      const color = e.point.color.getValue();
      return color.equals(Cesium.Color.fromCssColorString('#39FF14'));
    }).length;

    statsDiv.innerHTML = `
      <span class="globe-stats-label">Nodes:</span>
      <span class="globe-stats-value">${total}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Active:</span>
      <span class="globe-stats-value">${active}</span>
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
    loadNodes();
    
    // Load packet paths after nodes (so we have node positions)
    setTimeout(() => {
      loadPacketPaths();
    }, 1000);

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
  }

  // Cleanup when leaving the page
  function destroy() {
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
    
    // Auto-fade after 10 minutes
    setTimeout(() => {
      if (packetPaths.has(pathId)) {
        viewer.entities.remove(packetPaths.get(pathId));
        packetPaths.delete(pathId);
      }
    }, 600000);
  }

  // Add animated pulse effect for recent packets
  function addPulseEffect(fromPos, toPos, color) {
    const startTime = Cesium.JulianDate.now();
    const stopTime = Cesium.JulianDate.addSeconds(startTime, 2, new Cesium.JulianDate());
    
    // Create moving point along path
    const pulse = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startTime, stop: stopTime })
      ]),
      position: new Cesium.SampledPositionProperty(),
      point: {
        pixelSize: 8,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      }
    });
    
    // Animate position from source to destination
    pulse.position.addSample(startTime, fromPos);
    pulse.position.addSample(stopTime, toPos);
    
    // Remove after animation
    setTimeout(() => {
      viewer.entities.remove(pulse);
    }, 2500);
  }
