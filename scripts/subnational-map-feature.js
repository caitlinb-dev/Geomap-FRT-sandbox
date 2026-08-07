(function () {
  function createSubnationalMapFeature(options) {
    var featureOptions = options || {};
    var state = {
      cache: {},
      activeCountryID: null,
      mapStage: null,
      title: null,
      description: null,
      modal: null,
      closeButton: null,
      isInitialized: false
    };

    function normalizeBinaryFlag(value) {
      var normalized = String(value || '').toUpperCase();
      return normalized === 'Y' || normalized === 'N' ? normalized : 'N';
    }

    function getStatusColor(surveillanceExists, legalChallenge) {
      if (surveillanceExists === 'Y' && legalChallenge === 'Y') {
        return '#E49000';
      }

      if (surveillanceExists === 'Y') {
        return '#1e3283';
      }

      return '#d4d9e0';
    }

    function escapeHtml(input) {
      return String(input || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function normalizeSubnational(entry) {
      var subnational = entry && typeof entry.subnational === 'object' ? entry.subnational : {};
      var map = subnational && typeof subnational.map === 'object' ? subnational.map : null;
      var regions = subnational && typeof subnational.regions === 'object' && subnational.regions !== null
        ? subnational.regions
        : {};

      var normalizedRegions = {};
      Object.keys(regions).forEach(function (regionCode) {
        var regionEntry = regions[regionCode] || {};
        var regionSurveillance = normalizeBinaryFlag(regionEntry.surveillanceExists);
        var regionChallenge = normalizeBinaryFlag(regionEntry.legalChallenge);
        var parsedRegionYear = parseInt(regionEntry.firstExampleYear, 10);

        normalizedRegions[regionCode] = {
          name: regionEntry.name || regionCode,
          surveillanceExists: regionSurveillance,
          legalChallenge: regionChallenge,
          trackerLink: regionEntry.trackerLink || '',
          firstExampleYear: Number.isNaN(parsedRegionYear) ? null : parsedRegionYear,
          color: getStatusColor(regionSurveillance, regionChallenge)
        };
      });

      return {
        enabled: !!subnational.enabled,
        levelName: subnational.levelName || 'Region',
        map: map
          ? {
              format: map.format || 'geojson',
              url: map.url || '',
              regionCodeProperty: map.regionCodeProperty || 'id',
              regionCodePrefix: map.regionCodePrefix || ''
            }
          : null,
        regions: normalizedRegions
      };
    }

    function createTooltipMarkup(opts) {
      var subjectLabel = opts.subjectLabel || 'Country';
      var entityName = escapeHtml(opts.entityName || 'Unknown');
      var hasSurveillance = opts.surveillanceExists === 'Y' ? 'Yes' : 'No data';
      var hasChallenge = opts.legalChallenge === 'Y' ? 'Yes' : 'No data';
      var surveillanceColor = hasSurveillance === 'Yes' ? '#1e3283' : '#999';
      var challengeColor = opts.legalChallenge === 'Y' ? '#2c3e50' : '#999';
      var trackerLink = opts.trackerLink || '';
      var showTrackerLink = opts.surveillanceExists === 'Y' && !!trackerLink;
      var extraButtonHtml = opts.extraButtonHtml || '';

      return '<div style="padding: 12px 16px;">' +
        (opts.flagHtml || '') +
        '<div style="margin-bottom: 12px;">' +
        '<span style="color: #666; font-size: 12px; display: block; margin-bottom: 3px;">' + escapeHtml(subjectLabel) + ' name:</span>' +
        '<span style="font-weight: 600; font-size: 16px; color: #111;">' + entityName + '</span>' +
        '</div>' +
        '<div style="margin-bottom: 8px;">' +
        '<span style="color: #666; font-size: 12px; display: block; margin-bottom: 3px;">Has facial recognition been deployed:</span>' +
        '<span style="font-weight: 600; color: ' + surveillanceColor + ';">' + hasSurveillance + '</span>' +
        '</div>' +
        '<div style="margin-bottom: 12px;">' +
        '<span style="color: #666; font-size: 12px; display: block; margin-bottom: 3px;">Legal action initiated:</span>' +
        '<span style="font-weight: 600; color: ' + challengeColor + ';">' + hasChallenge + '</span>' +
        '</div>' +
        (showTrackerLink
          ? '<div style="padding-top: 12px; border-top: 1px solid #e0e0e0;">' +
            '<a class="js-tracker-link" href="' + escapeHtml(trackerLink) + '" target="_blank" rel="noopener noreferrer" style="color: #1e3283; text-decoration: underline; font-weight: 500; font-size: 13px;">Open PI News Tracker ↗</a>' +
            '</div>'
          : '') +
        extraButtonHtml +
        '</div>';
    }

    function setupModalElements() {
      if (state.isInitialized) {
        return;
      }

      state.modal = document.getElementById('subnationalModal');
      state.mapStage = document.getElementById('subnationalMapStage');
      state.title = document.getElementById('subnationalModalTitle');
      state.description = document.getElementById('subnationalModalDescription');
      state.closeButton = document.getElementById('subnationalModalCloseButton');

      if (state.closeButton) {
        state.closeButton.addEventListener('click', closeSubnationalModal);
      }

      if (state.modal) {
        state.modal.addEventListener('click', function (event) {
          var target = event.target;
          if (target && target.getAttribute('data-close-subnational') === 'true') {
            closeSubnationalModal();
          }
        });
      }

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && state.modal && !state.modal.hidden) {
          closeSubnationalModal();
        }
      });

      state.isInitialized = true;
    }

    function closeSubnationalModal() {
      if (!state.modal) {
        return;
      }

      state.modal.hidden = true;
      state.activeCountryID = null;
      document.body.style.overflow = '';
    }

    function getGeometryBounds(geometry) {
      var bounds = {
        minLon: Infinity,
        minLat: Infinity,
        maxLon: -Infinity,
        maxLat: -Infinity
      };

      function visitCoordinates(node) {
        if (!Array.isArray(node)) {
          return;
        }

        if (typeof node[0] === 'number' && typeof node[1] === 'number') {
          var lon = node[0];
          var lat = node[1];
          if (lon < bounds.minLon) bounds.minLon = lon;
          if (lon > bounds.maxLon) bounds.maxLon = lon;
          if (lat < bounds.minLat) bounds.minLat = lat;
          if (lat > bounds.maxLat) bounds.maxLat = lat;
          return;
        }

        node.forEach(visitCoordinates);
      }

      if (geometry && geometry.coordinates) {
        visitCoordinates(geometry.coordinates);
      }

      return bounds;
    }

    function geometryToPathData(geometry, projectPoint) {
      if (!geometry) {
        return '';
      }

      function ringToPath(ring) {
        if (!Array.isArray(ring) || ring.length === 0) {
          return '';
        }

        var output = '';
        ring.forEach(function (point, index) {
          var projected = projectPoint(point);
          output += (index === 0 ? 'M' : 'L') + projected.x + ' ' + projected.y + ' ';
        });

        return output + 'Z ';
      }

      if (geometry.type === 'Polygon') {
        return geometry.coordinates.map(ringToPath).join(' ').trim();
      }

      if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates
          .map(function (polygon) {
            return polygon.map(ringToPath).join(' ');
          })
          .join(' ')
          .trim();
      }

      return '';
    }

    function getRegionCode(feature, mapConfig) {
      var propertyName = mapConfig.regionCodeProperty || 'id';
      var prefix = mapConfig.regionCodePrefix || '';
      var properties = feature && feature.properties ? feature.properties : {};
      var rawCode = properties[propertyName];

      if (rawCode === undefined || rawCode === null || rawCode === '') {
        return null;
      }

      return prefix + String(rawCode).toUpperCase();
    }

    function showSubnationalError(message) {
      if (!state.mapStage) {
        return;
      }

      state.mapStage.innerHTML = '<div class="subnational-error">' + escapeHtml(message) + '</div>';
    }

    function renderSubnationalMap(countryID, countryValues) {
      var subnational = countryValues && countryValues.subnational ? countryValues.subnational : null;

      if (!subnational || !subnational.enabled || !subnational.map || !subnational.map.url) {
        showSubnationalError('No subnational map is configured for this country yet.');
        return Promise.resolve();
      }

      var mapUrl = subnational.map.url;

      if (state.cache[mapUrl]) {
        buildSubnationalSvg(state.cache[mapUrl], countryID, countryValues);
        return Promise.resolve();
      }

      return fetch(mapUrl)
        .then(function (response) {
          if (!response.ok) {
            throw new Error('Failed to load subnational map source.');
          }

          return response.json();
        })
        .then(function (geojson) {
          state.cache[mapUrl] = geojson;
          buildSubnationalSvg(geojson, countryID, countryValues);
        })
        .catch(function (error) {
          console.error('Subnational map load error:', error);
          showSubnationalError('Could not load the subnational map for this country.');
        });
    }

    function buildSubnationalSvg(geojson, countryID, countryValues) {
      if (!state.mapStage) {
        return;
      }

      var subnational = countryValues.subnational;
      var features = geojson && Array.isArray(geojson.features) ? geojson.features : [];

      if (features.length === 0) {
        showSubnationalError('No geographic features were found in this subnational map file.');
        return;
      }

      var bounds = {
        minLon: Infinity,
        minLat: Infinity,
        maxLon: -Infinity,
        maxLat: -Infinity
      };

      features.forEach(function (feature) {
        var featureBounds = getGeometryBounds(feature.geometry);
        if (featureBounds.minLon < bounds.minLon) bounds.minLon = featureBounds.minLon;
        if (featureBounds.minLat < bounds.minLat) bounds.minLat = featureBounds.minLat;
        if (featureBounds.maxLon > bounds.maxLon) bounds.maxLon = featureBounds.maxLon;
        if (featureBounds.maxLat > bounds.maxLat) bounds.maxLat = featureBounds.maxLat;
      });

      var width = 920;
      var height = 620;
      var padding = 22;
      var lonSpan = bounds.maxLon - bounds.minLon || 1;
      var latSpan = bounds.maxLat - bounds.minLat || 1;
      var scale = Math.min((width - padding * 2) / lonSpan, (height - padding * 2) / latSpan);

      function projectPoint(point) {
        var lon = point[0];
        var lat = point[1];
        return {
          x: (lon - bounds.minLon) * scale + padding,
          y: (bounds.maxLat - lat) * scale + padding
        };
      }

      state.mapStage.innerHTML = '';

      var tooltip = document.createElement('div');
      tooltip.className = 'subnational-tooltip';
      tooltip.hidden = true;

      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('class', 'subnational-map-svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', (countryValues.name || countryID) + ' subnational map');

      features.forEach(function (feature) {
        var regionCode = getRegionCode(feature, subnational.map);
        if (!regionCode) {
          return;
        }

        var regionData = subnational.regions[regionCode] || {
          name: (feature.properties && feature.properties.name) || regionCode,
          surveillanceExists: 'N',
          legalChallenge: 'N',
          trackerLink: '',
          firstExampleYear: null,
          color: '#d4d9e0'
        };

        var pathData = geometryToPathData(feature.geometry, projectPoint);
        if (!pathData) {
          return;
        }

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        path.setAttribute('class', 'subnational-region');
        path.setAttribute('data-region-code', regionCode);
        path.setAttribute('data-region-name', regionData.name || regionCode);
        path.style.fill = getStatusColor(regionData.surveillanceExists, regionData.legalChallenge);

        path.addEventListener('click', function (event) {
          svg.querySelectorAll('.subnational-region.subnational-active').forEach(function (activeEl) {
            activeEl.classList.remove('subnational-active');
          });

          path.classList.add('subnational-active');

          tooltip.innerHTML = createTooltipMarkup({
            subjectLabel: subnational.levelName || 'Region',
            entityName: regionData.name || regionCode,
            surveillanceExists: regionData.surveillanceExists,
            legalChallenge: regionData.legalChallenge,
            trackerLink: regionData.trackerLink
          });

          var rect = state.mapStage.getBoundingClientRect();
          var left = event.clientX - rect.left + 10;
          var top = event.clientY - rect.top + 10;

          tooltip.style.left = Math.max(8, Math.min(left, rect.width - 300)) + 'px';
          tooltip.style.top = Math.max(8, Math.min(top, rect.height - 180)) + 'px';
          tooltip.hidden = false;

          var trackerAnchor = tooltip.querySelector('.js-tracker-link');
          if (trackerAnchor) {
            ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(function (eventName) {
              trackerAnchor.addEventListener(eventName, function (anchorEvent) {
                anchorEvent.stopPropagation();
              });
            });
          }

          event.stopPropagation();
        });

        svg.appendChild(path);
      });

      svg.addEventListener('click', function () {
        tooltip.hidden = true;
        svg.querySelectorAll('.subnational-region.subnational-active').forEach(function (activeEl) {
          activeEl.classList.remove('subnational-active');
        });
      });

      state.mapStage.appendChild(svg);
      state.mapStage.appendChild(tooltip);
    }

    function openSubnationalModal(countryID) {
      setupModalElements();

      var baseValues = featureOptions.getBaseValues ? featureOptions.getBaseValues() : {};
      var countryValues = baseValues ? baseValues[countryID] : null;

      if (!countryValues || !countryValues.subnational || !countryValues.subnational.enabled) {
        return;
      }

      state.activeCountryID = countryID;
      state.modal.hidden = false;
      document.body.style.overflow = 'hidden';

      if (state.title) {
        state.title.textContent = (countryValues.name || countryID) + ' ' + (countryValues.subnational.levelName || 'Region') + ' Map';
      }

      if (state.description) {
        state.description.textContent = 'Click a ' + (countryValues.subnational.levelName || 'region').toLowerCase() + ' to view surveillance and legal challenge details.';
      }

      renderSubnationalMap(countryID, countryValues);
    }

    setupModalElements();

    return {
      normalizeBinaryFlag: normalizeBinaryFlag,
      getStatusColor: getStatusColor,
      normalizeSubnational: normalizeSubnational,
      createTooltipMarkup: createTooltipMarkup,
      openSubnationalModal: openSubnationalModal
    };
  }

  window.createSubnationalMapFeature = createSubnationalMapFeature;
})();
