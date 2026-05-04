/**
 * globe.js — 3D Globe view for MeshCore network with live packet animations
 * Uses Cesium for 3D visualization of nodes and packet paths
 */

'use strict';

(function() {
  let viewer;
  let nodeEntities = new Map();
  let nodeData = new Map(); // pubkey -> {name, lat, lon, role}
  let wsHandler;
  let statsDiv;
  let pulseInterval;
  let packetPaths = new Map();
  let activeAnimations = 0;
  const MAX_CONCURRENT_ANIMATIONS = 50;
  let packetCount = 0;
  let realisticPropagation = localStorage.getItem('globe-realistic-propagation') === 'true';
  let colorByHash = localStorage.getItem('meshcore-color-packets-by-hash') !== 'false';
  const propagationBuffer = new Map(); // hash -> {timer, packets[]}
  const PROPAGATION_BUFFER_MS = 800;

  // Packet type colors (from live.js)
  const TYPE_COLORS = {
    ADVERT: '#10b981',
    TRACE: '#3b82f6',
    MESSAGE: '#8b5cf6',
    ACK: '#22d3ee',
    DISC: '#f59e0b',
    UNKNOWN: '#6b7280'
  };

  // Initialize Cesium viewer
  async function initViewer(container) {
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJhZjMzYTczNS03YTlkLTRkOWItYjI1Zi02YjJhNjBmNjYxNjgiLCJpZCI6NDI2ODYzLCJpc3MiOiJodHRwczovL2lvbi5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3Nzc4NDY5NDl9.-m7FPQsB4syRZQn6mt2WZ7jffejFyk1twYRTBFe-7BA';

    viewer = new Cesium.Viewer(container, {
      baseLayerPicker: true,
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

    viewer.scene.globe.show = true;
    viewer.scene.skyBox.show = true;
    viewer.scene.sun.show = true;
    viewer.scene.moon.show = false;
    viewer.scene.globe.depthTestAgainstTerrain = true;

    console.log('[globe] Viewer created');

    // Set initial camera position over Lake Michigan looking west at Chicago
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-86.9, 41.88, 5000000), // Over the lake
      orientation: {
        heading: Cesium.Math.toRadians(270), // Point west toward Chicago
        pitch: Cesium.Math.toRadians(-50), // Angled view
        roll: 0
      }
    });

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

    // Hillshade overlay disabled for now - not rendering properly over satellite imagery
    // TODO: Revisit with actual terrain elevation data instead of pre-rendered tiles
    console.log('[globe] Terrain visualization disabled (hillshade tiles incompatible with Cesium Ion imagery)');
  }

  // Load nodes from API
  async function loadNodes() {
    try {
      const response = await fetch('/api/nodes');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const nodes = Array.isArray(data) ? data : (data.nodes || []);
      
      console.log(`[globe] Loading ${nodes.length} nodes`);
      
      nodes.forEach(node => {
        if (node.lat && node.lon && node.public_key) {
          nodeData.set(node.public_key, {
            name: node.name || node.public_key.slice(0, 8),
            lat: node.lat,
            lon: node.lon,
            role: node.role || 'unknown',
            last_seen: node.last_seen
          });
          addNodeToGlobe(node);
        }
      });
      
      console.log(`[globe] Loaded ${nodeEntities.size} nodes`);
      updateStats();
    } catch (err) {
      console.error('[globe] Failed to load nodes:', err);
    }
  }

  // Add node marker
  function addNodeToGlobe(node) {
    const position = Cesium.Cartesian3.fromDegrees(node.lon, node.lat, 0);
    
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

    const entity = viewer.entities.add({
      id: `node-${node.public_key}`,
      position: position,
      point: {
        pixelSize: 18,
        color: color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        scaleByDistance: new Cesium.NearFarScalar(1000, 2.0, 500000, 0.3)
      },
      label: {
        text: node.name || node.public_key.slice(0, 8),
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -20),
        show: true,
        scaleByDistance: new Cesium.NearFarScalar(1000, 1.2, 500000, 0.2)
      },
      description: `
        <div style="font-family: sans-serif;">
          <h3>${node.name || node.public_key.slice(0, 12)}</h3>
          <p><strong>Role:</strong> ${node.role}</p>
          <p><strong>Location:</strong> ${node.lat.toFixed(5)}, ${node.lon.toFixed(5)}</p>
          ${lastSeen ? `<p><strong>Last Seen:</strong> ${lastSeen.toLocaleString()}</p>` : ''}
        </div>
      `
    });

    nodeEntities.set(node.public_key, entity);
  }

  // Parse path from packet
  function getParsedPath(packet) {
    if (packet.path_json) {
      try {
        const parsed = typeof packet.path_json === 'string' ? JSON.parse(packet.path_json) : packet.path_json;
        return parsed.hops || [];
      } catch (e) {
        return [];
      }
    }
    return packet.decoded?.path?.hops || [];
  }

  // Resolve hop positions (adapted from live.js)
  function resolveHopPositions(hops, payload, resolvedPath) {
    const positions = [];
    
    // Try sender from payload first
    if (payload?.pubKey && nodeData.has(payload.pubKey)) {
      const node = nodeData.get(payload.pubKey);
      positions.push({
        key: payload.pubKey,
        lat: node.lat,
        lon: node.lon,
        ghost: false
      });
    }

    // Process hops
    hops.forEach(hop => {
      const key = hop.pubKey || hop;
      if (nodeData.has(key)) {
        const node = nodeData.get(key);
        positions.push({
          key: key,
          lat: node.lat,
          lon: node.lon,
          ghost: false
        });
      } else if (hop.lat && hop.lon) {
        // Ghost hop with coordinates
        positions.push({
          key: key,
          lat: hop.lat,
          lon: hop.lon,
          ghost: true
        });
      }
    });

    return positions;
  }

  // Render packet tree (adapted from live.js)
  function renderPacketTree(packets) {
    if (!packets || !packets.length) return;
    
    const first = packets[0];
    const decoded = first.decoded || {};
    const header = decoded.header || {};
    const payload = decoded.payload || {};
    const typeName = header.payloadTypeName || 'UNKNOWN';
    const color = TYPE_COLORS[typeName] || '#6b7280';
    
    // Update packet count
    packetCount += packets.length;
    updateStats();

    // Extract unique paths
    const allPaths = [];
    const seenPathKeys = new Set();
    
    packets.forEach(pkt => {
      const hops = getParsedPath(pkt);
      const pathKey = hops.map(h => h.pubKey || h).join(',');
      
      if (!seenPathKeys.has(pathKey)) {
        seenPathKeys.add(pathKey);
        const hopPositions = resolveHopPositions(hops, payload, null);
        
        if (hopPositions.length >= 2) {
          allPaths.push({
            hopPositions: hopPositions,
            hash: first.hash,
            typeName: typeName,
            color: color
          });
        } else if (hopPositions.length === 1) {
          // Single node - pulse it
          pulseNode(hopPositions[0].lat, hopPositions[0].lon, color);
        }
      }
    });

    // Animate all unique paths
    allPaths.forEach(path => {
      animatePath(path.hopPositions, path.typeName, path.color, path.hash);
    });
  }

  // Animate packet path
  function animatePath(hopPositions, typeName, color, hash) {
    if (activeAnimations >= MAX_CONCURRENT_ANIMATIONS) return;
    if (hopPositions.length < 2) return;
    
    activeAnimations++;
    
    // Build Cesium positions
    const positions = hopPositions.map(hp => 
      Cesium.Cartesian3.fromDegrees(hp.lon, hp.lat, 500) // 500m altitude
    );

    // Hash-based color
    let pathColor = Cesium.Color.fromCssColorString(color);
    if (colorByHash && hash && window.HashColor) {
      try {
        const hsl = window.HashColor.hashToHsl(hash, 'dark');
        pathColor = Cesium.Color.fromCssColorString(hsl);
      } catch (e) {}
    }

    // Create contrail polyline
    const contrailEntity = viewer.entities.add({
      polyline: {
        positions: positions,
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: pathColor.withAlpha(0.3)
        }),
        arcType: Cesium.ArcType.GEODESIC
      }
    });

    // Animate packet dot along path
    const startTime = Cesium.JulianDate.now();
    const stopTime = Cesium.JulianDate.addSeconds(startTime, hopPositions.length * 0.5, new Cesium.JulianDate());
    
    const sampledPosition = new Cesium.SampledPositionProperty();
    hopPositions.forEach((hp, i) => {
      const time = Cesium.JulianDate.addSeconds(startTime, i * 0.5, new Cesium.JulianDate());
      sampledPosition.addSample(time, Cesium.Cartesian3.fromDegrees(hp.lon, hp.lat, 500));
      
      // Pulse node on arrival
      setTimeout(() => {
        pulseNode(hp.lat, hp.lon, pathColor);
      }, i * 500);
    });

    const packetDot = viewer.entities.add({
      position: sampledPosition,
      point: {
        pixelSize: 10,
        color: pathColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      availability: new Cesium.TimeIntervalCollection([
        new Cesium.TimeInterval({ start: startTime, stop: stopTime })
      ])
    });

    // Cleanup after animation
    setTimeout(() => {
      viewer.entities.remove(packetDot);
      
      // Fade contrail
      let opacity = 0.3;
      const fadeInterval = setInterval(() => {
        opacity -= 0.05;
        if (opacity <= 0) {
          viewer.entities.remove(contrailEntity);
          clearInterval(fadeInterval);
          activeAnimations = Math.max(0, activeAnimations - 1);
          updateStats();
        } else {
          contrailEntity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: pathColor.withAlpha(opacity)
          });
        }
      }, 100);
    }, hopPositions.length * 500);
  }

  // Pulse node
  function pulseNode(lat, lon, color) {
    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    const pulseColor = color instanceof Cesium.Color ? color : Cesium.Color.fromCssColorString(color);
    
    const pulse = viewer.entities.add({
      position: position,
      ellipsoid: {
        radii: new Cesium.Cartesian3(100, 100, 100),
        material: pulseColor.withAlpha(0.5)
      }
    });

    let scale = 1.0;
    const pulseInterval = setInterval(() => {
      scale += 0.2;
      if (scale >= 3.0) {
        viewer.entities.remove(pulse);
        clearInterval(pulseInterval);
      } else {
        pulse.ellipsoid.radii = new Cesium.Cartesian3(100 * scale, 100 * scale, 100 * scale);
        pulse.ellipsoid.material = pulseColor.withAlpha(0.5 / scale);
      }
    }, 50);
  }

  // Handle incoming packet from WebSocket
  function handlePacket(packet) {
    if (realisticPropagation && packet.hash) {
      // Buffer packets by hash
      if (propagationBuffer.has(packet.hash)) {
        propagationBuffer.get(packet.hash).packets.push(packet);
      } else {
        const entry = {
          packets: [packet],
          timer: setTimeout(() => {
            const buffered = propagationBuffer.get(packet.hash);
            propagationBuffer.delete(packet.hash);
            if (buffered) renderPacketTree(buffered.packets);
          }, PROPAGATION_BUFFER_MS)
        };
        propagationBuffer.set(packet.hash, entry);
      }
    } else {
      renderPacketTree([packet]);
    }
  }

  // Update stats display
  function updateStats() {
    if (!statsDiv) return;
    
    const nodeCount = nodeEntities.size;
    const animCount = activeAnimations;
    
    statsDiv.innerHTML = `
      <span class="globe-stats-label">Nodes:</span>
      <span class="globe-stats-value">${nodeCount}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Packets:</span>
      <span class="globe-stats-value">${packetCount}</span>
      <span class="globe-stats-label" style="margin-left: 12px;">Active:</span>
      <span class="globe-stats-value">${animCount}</span>
    `;
  }

  // Initialize
  async function init(app, routeParam) {
    app.innerHTML = `
      <div id="globeContainer" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0;">
        <style>
          /* Push Cesium widgets below navbar */
          .cesium-viewer .cesium-viewer-toolbar,
          .cesium-viewer .cesium-viewer-bottom {
            top: 60px !important;
          }
          .cesium-baseLayerPicker-dropDown {
            top: 60px !important;
          }
        </style>
      </div>
      <div class="globe-stats" id="globeStats" style="position: absolute; top: 70px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 13px; z-index: 1000;">Loading...</div>
      <div class="globe-controls" id="globeControls" style="position: absolute; top: 70px; right: 10px; background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 4px; font-family: sans-serif; font-size: 12px; z-index: 1000;">
        <label style="display: block; margin-bottom: 6px; cursor: pointer;">
          <input type="checkbox" id="globeRealisticToggle" style="margin-right: 6px;">
          Realistic propagation
        </label>
        <label style="display: block; cursor: pointer;">
          <input type="checkbox" id="globeColorHashToggle" style="margin-right: 6px;">
          Color by hash
        </label>
      </div>
    `;

    const container = document.getElementById('globeContainer');
    statsDiv = document.getElementById('globeStats');

    if (typeof Cesium === 'undefined') {
      app.innerHTML = '<div style="padding: 40px; text-align: center;">Cesium not loaded</div>';
      return;
    }

    await initViewer(container);
    await loadNodes();

    // Set up controls
    const realisticToggle = document.getElementById('globeRealisticToggle');
    realisticToggle.checked = realisticPropagation;
    realisticToggle.addEventListener('change', (e) => {
      realisticPropagation = e.target.checked;
      localStorage.setItem('globe-realistic-propagation', realisticPropagation);
    });

    const colorHashToggle = document.getElementById('globeColorHashToggle');
    colorHashToggle.checked = colorByHash;
    colorHashToggle.addEventListener('change', (e) => {
      colorByHash = e.target.checked;
      localStorage.setItem('meshcore-color-packets-by-hash', colorByHash);
    });

    // WebSocket handler
    wsHandler = function(msg) {
      if (msg.type === 'packet' && msg.packet) {
        handlePacket(msg.packet);
      } else if (msg.type === 'node' && msg.node) {
        // Update node data
        if (msg.node.public_key && msg.node.lat && msg.node.lon) {
          nodeData.set(msg.node.public_key, {
            name: msg.node.name || msg.node.public_key.slice(0, 8),
            lat: msg.node.lat,
            lon: msg.node.lon,
            role: msg.node.role || 'unknown',
            last_seen: msg.node.last_seen
          });
          
          // Add node if not exists
          if (!nodeEntities.has(msg.node.public_key)) {
            addNodeToGlobe(msg.node);
          }
        }
      }
    };
    
    if (window.registerWSHandler) {
      registerWSHandler(wsHandler);
    }
  }

  // Cleanup
  function destroy() {
    if (pulseInterval) clearInterval(pulseInterval);
    if (viewer) {
      viewer.destroy();
      viewer = null;
    }
    nodeEntities.clear();
    nodeData.clear();
    packetPaths.clear();
    propagationBuffer.clear();
    if (wsHandler && window.unregisterWSHandler) {
      unregisterWSHandler(wsHandler);
      wsHandler = null;
    }
    statsDiv = null;
  }

  // Register page
  registerPage('globe', {
    init: init,
    destroy: destroy
  });

})();
