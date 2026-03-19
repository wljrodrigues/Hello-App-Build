class WMSLayerExplorer {
    constructor() {
        this.baseUrl = 'https://portalmaps.com.br/geoserver/wms';
        this.layers = [];
        this.filteredLayers = [];
        this.init();
    }

    init() {
        this.bindEvents();
    }

    bindEvents() {
        document.getElementById('loadLayers').addEventListener('click', () => {
            this.loadLayers();
        });

        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterLayers(e.target.value);
        });
    }

    async loadLayers() {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const layersContainer = document.getElementById('layersContainer');
        const stats = document.getElementById('stats');

        loading.style.display = 'block';
        error.style.display = 'none';
        layersContainer.style.display = 'none';
        stats.style.display = 'none';

        try {
            const capabilities = await this.getCapabilities();
            this.layers = this.parseCapabilities(capabilities);
            this.filteredLayers = [...this.layers];
            
            this.updateStats();
            this.renderLayers();
            
            loading.style.display = 'none';
            layersContainer.style.display = 'block';
            stats.style.display = 'flex';
        } catch (err) {
            console.error('Erro ao carregar camadas:', err);
            loading.style.display = 'none';
            error.style.display = 'block';
        }
    }

    async getCapabilities() {
        const url = `${this.baseUrl}?service=WMS&version=1.3.0&request=GetCapabilities`;
        
        // Try multiple proxy strategies
        const proxies = [
            `https://corsproxy.io/?${encodeURIComponent(url)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
            `https://cors-anywhere.herokuapp.com/${url}`,
            url // Direct request as last resort
        ];
        
        for (const proxyUrl of proxies) {
            try {
                console.log(`Tentando proxy: ${proxyUrl}`);
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/xml, text/xml, */*',
                        'User-Agent': 'WMS Layer Explorer'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                
                const text = await response.text();
                if (!text || text.trim() === '') {
                    throw new Error('Empty response');
                }
                
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, 'text/xml');
                
                // Check if parsing was successful
                const parseError = xmlDoc.querySelector('parsererror');
                if (parseError) {
                    throw new Error('XML parsing error');
                }
                
                console.log('Sucesso com proxy:', proxyUrl);
                return xmlDoc;
                
            } catch (error) {
                console.warn(`Falha com proxy ${proxyUrl}:`, error.message);
                continue;
            }
        }
        
        throw new Error('Todos os proxies falharam. Verifique sua conexão ou tente novamente mais tarde.');
    }

    parseCapabilities(xmlDoc) {
        const layers = [];
        const layerElements = xmlDoc.querySelectorAll('Layer[queryable="1"]');
        
        layerElements.forEach(layer => {
            const name = layer.querySelector('Name')?.textContent;
            const title = layer.querySelector('Title')?.textContent || name;
            const abstract = layer.querySelector('Abstract')?.textContent || 'Sem descrição disponível';
            
            // Verificar se tem bbox
            const bbox = layer.querySelector('BoundingBox, EX_GeographicBoundingBox');
            
            if (name && bbox) {
                layers.push({
                    name,
                    title,
                    abstract,
                    bbox: this.parseBoundingBox(bbox)
                });
            }
        });
        
        return layers;
    }

    parseBoundingBox(bboxElement) {
        if (bboxElement.tagName === 'BoundingBox') {
            return {
                minx: parseFloat(bboxElement.getAttribute('minx')),
                miny: parseFloat(bboxElement.getAttribute('miny')),
                maxx: parseFloat(bboxElement.getAttribute('maxx')),
                maxy: parseFloat(bboxElement.getAttribute('maxy'))
            };
        } else {
            // EX_GeographicBoundingBox
            return {
                minx: parseFloat(bboxElement.querySelector('westBoundLongitude')?.textContent),
                miny: parseFloat(bboxElement.querySelector('southBoundLatitude')?.textContent),
                maxx: parseFloat(bboxElement.querySelector('eastBoundLongitude')?.textContent),
                maxy: parseFloat(bboxElement.querySelector('northBoundLatitude')?.textContent)
            };
        }
    }

    filterLayers(searchTerm) {
        const term = searchTerm.toLowerCase();
        this.filteredLayers = this.layers.filter(layer =>
            layer.name.toLowerCase().includes(term) ||
            layer.title.toLowerCase().includes(term) ||
            layer.abstract.toLowerCase().includes(term)
        );
        
        this.updateStats();
        this.renderLayers();
    }

    updateStats() {
        document.getElementById('totalLayers').textContent = this.layers.length;
        document.getElementById('filteredLayers').textContent = this.filteredLayers.length;
    }

    renderLayers() {
        const grid = document.getElementById('layersGrid');
        grid.innerHTML = '';

        this.filteredLayers.forEach(layer => {
            const card = this.createLayerCard(layer);
            grid.appendChild(card);
        });
    }

    createLayerCard(layer) {
        const card = document.createElement('div');
        card.className = 'layer-card';
        
        card.innerHTML = `
            <div class="layer-title">${layer.title}</div>
            <div class="layer-name">${layer.name}</div>
            <div class="layer-abstract">${layer.abstract}</div>
            <div class="layer-actions">
                <button class="btn-download" onclick="explorer.downloadLayerAsJSON('${layer.name}', this)">
                    📥 Baixar JSON
                </button>
                <button class="btn-info" onclick="explorer.showLayerInfo('${layer.name}')">
                    ℹ️ Info
                </button>
                <button class="btn-map" onclick="explorer.showLayerMap('${layer.name}')">
                    🗺️ Exibir Mapa
                </button>
            </div>
            <div class="download-status" id="status-${layer.name.replace(/[^a-zA-Z0-9]/g, '_')}" style="display: none;"></div>
        `;
        
        return card;
    }

    async downloadLayerAsJSON(layerName, button) {
        const statusId = `status-${layerName.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const statusElement = document.getElementById(statusId);
        
        button.disabled = true;
        statusElement.style.display = 'block';
        statusElement.className = 'download-status loading';
        statusElement.textContent = 'Baixando...';

        try {
            const layer = this.layers.find(l => l.name === layerName);
            if (!layer) throw new Error('Camada não encontrada');

            // Fazer requisição GetFeature para obter dados em GeoJSON
            const url = `${this.baseUrl}?service=WFS&version=2.0.0&request=GetFeature&typeName=${layerName}&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=1000`;
            
            // Try multiple proxy strategies for download too
            const proxies = [
                `https://corsproxy.io/?${encodeURIComponent(url)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
                `https://cors-anywhere.herokuapp.com/${url}`
            ];
            
            let geoJSON = null;
            let downloadError = null;
            
            for (const proxyUrl of proxies) {
                try {
                    const response = await fetch(proxyUrl, {
                        headers: {
                            'Accept': 'application/json, application/geo+json, */*'
                        }
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error: ${response.status}`);
                    }
                    
                    geoJSON = await response.json();
                    break;
                    
                } catch (error) {
                    downloadError = error;
                    continue;
                }
            }
            
            if (!geoJSON) {
                throw downloadError || new Error('Falha em todos os proxies de download');
            }
            
            // Adicionar metadados à resposta
            const dataWithMetadata = {
                metadata: {
                    source: 'Portal Maps WMS/WFS',
                    layer: layerName,
                    title: layer.title,
                    abstract: layer.abstract,
                    bbox: layer.bbox,
                    downloadedAt: new Date().toISOString(),
                    totalFeatures: geoJSON.features?.length || 0
                },
                geojson: geoJSON
            };
            
            // Criar e baixar arquivo
            const blob = new Blob([JSON.stringify(dataWithMetadata, null, 2)], {
                type: 'application/json'
            });
            
            const downloadUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `${layerName.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            
            statusElement.className = 'download-status success';
            statusElement.textContent = `✅ Download concluído (${dataWithMetadata.metadata.totalFeatures} features)`;
            
        } catch (error) {
            console.error('Erro no download:', error);
            statusElement.className = 'download-status error';
            statusElement.textContent = `❌ Erro: ${error.message}`;
        } finally {
            button.disabled = false;
            setTimeout(() => {
                statusElement.style.display = 'none';
            }, 5000);
        }
    }

    showLayerInfo(layerName) {
        const layer = this.layers.find(l => l.name === layerName);
        if (!layer) return;

        const info = `
Camada: ${layer.title}
Nome: ${layer.name}
Descrição: ${layer.abstract}

Bounding Box:
- Min X: ${layer.bbox.minx}
- Min Y: ${layer.bbox.miny}
- Max X: ${layer.bbox.maxx}
- Max Y: ${layer.bbox.maxy}

Servidor: ${this.baseUrl}
        `;
        
        alert(info);
    }

    showLayerMap(layerName) {
        const layer = this.layers.find(l => l.name === layerName);
        if (!layer || !layer.bbox) {
            alert('Informações de localização não disponíveis para esta camada');
            return;
        }

        // Create overlay and popup elements
        const overlay = document.createElement('div');
        overlay.className = 'map-overlay';
        
        const popup = document.createElement('div');
        popup.className = 'map-popup';
        
        popup.innerHTML = `
            <div class="map-popup-header">
                <span>${layer.title}</span>
                <button class="map-popup-close" onclick="this.closest('.map-overlay').remove()">✕</button>
            </div>
            <div class="map-popup-content" id="mapContainer-${Date.now()}"></div>
            <div class="map-loading" id="mapLoading-${Date.now()}" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: none;">
                <div class="spinner" style="width: 30px; height: 30px;"></div>
                <p style="margin-top: 10px; font-size: 0.9rem;">Carregando features...</p>
            </div>
        `;
        
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        
        // Show the popup
        overlay.style.display = 'block';
        popup.style.display = 'block';
        
        // Initialize map after a short delay to ensure DOM is ready
        setTimeout(async () => {
            const mapContainerId = popup.querySelector('.map-popup-content').id;
            const loadingId = popup.querySelector('.map-loading').id;
            const loadingElement = document.getElementById(loadingId);
            
            const map = L.map(mapContainerId);
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            // Set initial view to bounding box
            const bounds = [
                [layer.bbox.miny, layer.bbox.minx],
                [layer.bbox.maxy, layer.bbox.maxx]
            ];
            map.fitBounds(bounds);
            
            // Show loading indicator
            loadingElement.style.display = 'block';
            
            try {
                // Fetch GeoJSON features from WFS
                const wfsUrl = `${this.baseUrl.replace('/wms', '/wfs')}?service=WFS&version=2.0.0&request=GetFeature&typeName=${layerName}&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=100`;
                
                const proxies = [
                    `https://corsproxy.io/?${encodeURIComponent(wfsUrl)}`,
                    `https://api.allorigins.win/raw?url=${encodeURIComponent(wfsUrl)}`,
                    `https://cors-anywhere.herokuapp.com/${wfsUrl}`
                ];
                
                let geoJSON = null;
                let fetchError = null;
                
                for (const proxyUrl of proxies) {
                    try {
                        const response = await fetch(proxyUrl, {
                            headers: {
                                'Accept': 'application/json, application/geo+json, */*'
                            }
                        });
                        
                        if (!response.ok) {
                            throw new Error(`HTTP error: ${response.status}`);
                        }
                        
                        geoJSON = await response.json();
                        break;
                        
                    } catch (error) {
                        fetchError = error;
                        continue;
                    }
                }
                
                loadingElement.style.display = 'none';
                
                if (geoJSON && geoJSON.features && geoJSON.features.length > 0) {
                    // Add GeoJSON features to map
                    const geoJSONLayer = L.geoJSON(geoJSON, {
                        style: {
                            color: '#9ACD32',
                            fillColor: '#9ACD32',
                            fillOpacity: 0.3,
                            weight: 2
                        },
                        onEachFeature: (feature, featureLayer) => {
                            // Create popup content with feature properties
                            let popupContent = `<strong>${layer.title}</strong><br><small>${layer.name}</small><br><br>`;
                            
                            if (feature.properties) {
                                const props = feature.properties;
                                const propKeys = Object.keys(props).slice(0, 5); // Show first 5 properties
                                
                                propKeys.forEach(key => {
                                    if (props[key] !== null && props[key] !== undefined && props[key] !== '') {
                                        popupContent += `<strong>${key}:</strong> ${props[key]}<br>`;
                                    }
                                });
                                
                                if (Object.keys(props).length > 5) {
                                    popupContent += `<em>... e mais ${Object.keys(props).length - 5} propriedades</em>`;
                                }
                            }
                            
                            featureLayer.bindPopup(popupContent);
                        }
                    }).addTo(map);
                    
                    // Fit map to the actual features
                    if (geoJSONLayer.getBounds().isValid()) {
                        map.fitBounds(geoJSONLayer.getBounds());
                    }
                    
                } else {
                    // Fallback to bounding box if no features found
                    const rectangle = L.rectangle(bounds, {
                        color: '#9ACD32',
                        fillColor: '#9ACD32',
                        fillOpacity: 0.3,
                        weight: 3
                    }).addTo(map);
                    
                    rectangle.bindPopup(`
                        <strong>${layer.title}</strong><br>
                        <small>${layer.name}</small><br>
                        <em>Nenhuma feature encontrada. Exibindo área de cobertura.</em><br>
                        <small>${layer.abstract.substring(0, 100)}${layer.abstract.length > 100 ? '...' : ''}</small>
                    `);
                }
                
            } catch (error) {
                console.error('Erro ao carregar features:', error);
                loadingElement.style.display = 'none';
                
                // Fallback to bounding box on error
                const rectangle = L.rectangle(bounds, {
                    color: '#9ACD32',
                    fillColor: '#9ACD32',
                    fillOpacity: 0.3,
                    weight: 3
                }).addTo(map);
                
                rectangle.bindPopup(`
                    <strong>${layer.title}</strong><br>
                    <small>${layer.name}</small><br>
                    <em>Erro ao carregar features. Exibindo área de cobertura.</em><br>
                    <small>Erro: ${error.message}</small>
                `);
            }
            
            // Close popup when clicking overlay
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                }
            });
            
        }, 100);
    }
}

// Inicializar a aplicação
const explorer = new WMSLayerExplorer();

// Tornar o explorer globalmente acessível
window.explorer = explorer;
