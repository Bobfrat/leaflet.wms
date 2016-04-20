/*!
 * leaflet.wms.js
 * A collection of Leaflet utilities for working with Web Mapping services.
 * (c) 2014, Houston Engineering, Inc.
 * MIT License
 */

(function (factory) {
    // Module systems magic dance, Leaflet edition
    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['leaflet'], factory);
    } else if (typeof module !== 'undefined') {
        // Node/CommonJS
        module.exports = factory(require('leaflet'));
    } else {
        // Browser globals
        if (typeof this.L === 'undefined')
            throw 'Leaflet must be loaded first!';
        // Namespace
        this.L.WMS = this.L.wms = factory(this.L);
    }
}(function (L) {

// Module object
var wms = {};

// Hacky backport of L.Layer for 0.7.3
if (!L.Layer) {
    L.Layer = L.LayerGroup.extend({
        'onAdd': function(map) {
            this._map = map;
            if (map && this.getEvents) {
                var events = this.getEvents();
                for (var evt in events) {
                    map.on(evt, events[evt], this);
                }
            }
        },
        'onRemove': function() {
            delete this._map;
        }
    });
}

/*
 * wms.Source
 * The Source object manages a single WMS connection.  Multiple "layers" can be
 * created with the getLayer function, but a single request will be sent for
 * each image update.  Can be used in non-tiled "overlay" mode (default), or
 * tiled mode, via an internal wms.Overlay or wms.TileLayer, respectively.
 */
wms.Source = L.Layer.extend({
    'options': {
        'tiled': false,
        'identify': true
    },

    'initialize': function(url, options) {
        this._url = url;
        this._subLayers = {};
        options = L.setOptions(this, options);
        this._overlay = this.createOverlay(url, options);
    },

    'createOverlay': function(url, options) {
        if (options.tiled) {
            return wms.tileLayer(url, options);
        } else {
            return wms.overlay(url, options);
        }
    },

    'onAdd': function(map) {
        L.Layer.prototype.onAdd.call(this, map);
        this.refreshOverlay();
    },

    'getEvents': function() {
        if (this.options.identify) {
            return {'click': this.identify};
        } else {
            return {};
        }
    },

    'getLayer': function(name) {
        return wms.layer(this, name);
    },

    'addSubLayer': function(name) {
        this._subLayers[name] = true;
        this.refreshOverlay();
    },

    'removeSubLayer': function(name) {
        delete this._subLayers[name];
        this.refreshOverlay();
    },

    'refreshOverlay': function() {
        var subLayers = Object.keys(this._subLayers).join(",");
        if (!this._map) {
            return;
        }
        if (!subLayers) {
            this._map.removeLayer(this._overlay);
        } else {
            this._overlay.setParams({'layers': subLayers});
            this._overlay.addTo(this._map);
        }
    },

    'identify': function(evt) {
        // Identify map features in response to map clicks. To customize this
        // behavior, create a class extending wms.Source and override one or
        // more of the following hook functions.

        var layers = this.getIdentifyLayers();
        if (!layers.length) {
            return;
        }
        this.getFeatureInfo(
            evt.containerPoint, evt.latlng, layers,
            this.showFeatureInfo
        );
    },

    'getFeatureInfo': function(point, latlng, layers, callback) {
        // Request WMS GetFeatureInfo and call callback with results
        // (split from identify() to faciliate use outside of map events)
        var params = this.getFeatureInfoParams(point, layers),
            url = this._url + L.Util.getParamString(params, this._url);

        this.showWaiting();
        ajax.call(this, url, done);

        function done(result) {
            this.hideWaiting();
            var text = this.parseFeatureInfo(result, url);
            callback.call(this, latlng, text);
        }
    },

    'getIdentifyLayers': function() {
        // Hook to determine which layers to identify
        if (this.options.identifyLayers)
            return this.options.identifyLayers;
        return Object.keys(this._subLayers);
     },

    'getFeatureInfoParams': function(point, layers) {
        // Hook to generate parameters for WMS service GetFeatureInfo request
        var wmsParams, overlay;
        if (this.options.tiled) {
            // Create overlay instance to leverage updateWmsParams
            overlay = wms.overlay(this._url, this.options);
            overlay.updateWmsParams(this._map);
            wmsParams = overlay.wmsParams;
            wmsParams.layers = layers.join(',');
        } else {
            // Use existing overlay
            wmsParams = this._overlay.wmsParams;
        }
        var infoParams = {
            'request': 'GetFeatureInfo',
            'query_layers': layers.join(','),
            'X': point.x,
            'Y': point.y
        };
        return L.extend({}, wmsParams, infoParams);
    },

    'parseFeatureInfo': function(result, url) {
        // Hook to handle parsing AJAX response
        if (result == "error") {
            // AJAX failed, possibly due to CORS issues.
            // Try loading content in <iframe>.
            result = "<iframe src='" + url + "' style='border:none'>";
        }
        return result;
    },

    'showFeatureInfo': function(latlng, info) {
        // Hook to handle displaying parsed AJAX response to the user
        if (!this._map) {
            return;
        }
        this._map.openPopup(info, latlng);
    },

    'showWaiting': function() {
        // Hook to customize AJAX wait animation
        if (!this._map)
            return;
        this._map._container.style.cursor = "progress";
    },

    'hideWaiting': function() {
        // Hook to remove AJAX wait animation
        if (!this._map)
            return;
        this._map._container.style.cursor = "default";
    }
});

wms.source = function(url, options) {
    return new wms.Source(url, options);
};

/*
 * Layer
 * Leaflet "layer" with all actual rendering handled via an underlying Source
 * object.  Can be called directly with a URL to automatically create or reuse
 * an existing Source.  Note that the auto-source feature doesn't work well in
 * multi-map environments; so for best results, create a Source first and use
 * getLayer() to retrieve wms.Layer instances.
 */

wms.Layer = L.Layer.extend({
    'initialize': function(source, layerName, options) {
        if (!source.addSubLayer) {
            // Assume source is a URL
            source = wms.getSourceForUrl(source, options);
        }
        this._source = source;
        this._name = layerName;
    },
    'onAdd': function(map) {
        L.Layer.prototype.onAdd.call(this, map);
        if (!this._source._map)
            this._source.addTo(this._map);
        this._source.addSubLayer(this._name);
    },
    'onRemove': function() {
        this._source.removeSubLayer(this._name);
    }
});

wms.layer = function(source, options) {
    return new wms.Layer(source, options);
};

// Cache of sources for use with wms.Layer auto-source option
var sources = {};
wms.getSourceForUrl = function(url, options) {
    if (!sources[url]) {
        sources[url] = wms.source(url, options);
    }
    return sources[url];
};


// Copy tiled WMS layer from leaflet core, in case we need to subclass it later
wms.TileLayer = L.TileLayer.WMS;
wms.tileLayer = L.tileLayer.wms;

/*
 * wms.Overlay:
 * "Single Tile" WMS image overlay that updates with map changes.
 * Portions of wms.Overlay are directly extracted from L.TileLayer.WMS.
 * See Leaflet license.
 */
wms.Overlay = L.Layer.extend({
    'defaultWmsParams': {
        'service': 'WMS',
        'request': 'GetMap',
        'version': '1.1.1',
        'layers': '',
        'styles': '',
        'format': 'image/jpeg',
        'transparent': false
    },

    'initialize': function(url, options) {
        this._url = url;

        // Move WMS parameters to params object
        var optNames = {
            'crs': true,
            'uppercase': true,
            'tiled': true,
            'identify': true,
            'opacity': true,
            'attribution': true
        };
        // Allow for an onError callback
        if(options && options.onError) {
          this.onError = options.onError;
        }
        
        var params = {};
        for (var opt in options) {
             if (options.hasOwnProperty(opt) && !optNames[opt]) {
                 params[opt] = options[opt];
                 delete options[opt];
             }
        }
        L.setOptions(this, options);
        this.wmsParams = L.extend({}, this.defaultWmsParams, params);
    },

    'setParams': function(params) {
        L.extend(this.wmsParams, params);
        this.update();
    },

    'getAttribution': function() {
        return this.options.attribution;
    },

    'onAdd': function(map) {
        L.Layer.prototype.onAdd.call(this, map);
        this.update();
    },

    'onRemove': function(map) {
        if (this._currentOverlay) {
            map.removeLayer(this._currentOverlay);
            delete this._currentOverlay;
        }
        if (this._currentUrl) {
            delete this._currentUrl;
        }
        L.Layer.prototype.onRemove.call(this, map);
    },

    'getEvents': function() {
        return {
            'moveend': this.update
        };
    },

    'update': function() {
        if (!this._map) {
            return;
        }
        // Determine image URL and whether it has changed since last update
        this.updateWmsParams();
        var url = this.getImageUrl();
        if (this._currentUrl == url) {
            return;
        }
        this._currentUrl = url;

        // Keep current image overlay in place until new one loads
        // (inspired by esri.leaflet)
        var bounds = this._map.getBounds();
        var overlay = L.imageOverlay(url, bounds, {'opacity': 0});
        overlay.addTo(this._map);
        overlay.once('load', _swap, this);
        // Listen for a failure to load the image source and then call this.onError callback
        L.DomEvent.on(overlay._image, 'error', (function() {
            if(this.onError !== undefined) {
                this.onError({error: "Failed to load layer", url: overlay._image.src});
            }
        }).bind(this));
        
        function _swap() {
            if (!this._map) {
                return;
            }
            if (overlay._url != this._currentUrl) {
                this._map.removeLayer(overlay);
                return;
            } else if (this._currentOverlay) {
                this._map.removeLayer(this._currentOverlay);
            }
            this._currentOverlay = overlay;
            overlay.setOpacity(
                this.options.opacity ? this.options.opacity : 1
            );
        }
    },

    // See L.TileLayer.WMS: onAdd() & getTileUrl()
    'updateWmsParams': function(map) {
        if (!map) {
            map = this._map;
        }
        // Compute WMS options
        var bounds = map.getBounds();
        var size = map.getSize();
        var wmsVersion = parseFloat(this.wmsParams.version);
        var crs = this.options.crs || map.options.crs;
        var projectionKey = wmsVersion >= 1.3 ? 'crs' : 'srs';
        var nw = crs.project(bounds.getNorthWest());
        var se = crs.project(bounds.getSouthEast());

        // Assemble WMS parameter string
        var params = {
            'width': size.x,
            'height': size.y
        };
        params[projectionKey] = crs.code;
        params.bbox = (
            wmsVersion >= 1.3 && crs === L.CRS.EPSG4326 ?
            [se.y, nw.x, nw.y, se.x] :
            [nw.x, se.y, se.x, nw.y]
        ).join(',');

        L.extend(this.wmsParams, params);
    },

    'getImageUrl': function() {
        var uppercase = this.options.uppercase || false;
        var pstr = L.Util.getParamString(this.wmsParams, this._url, uppercase);
        return this._url + pstr;
    }
});

wms.overlay = function(url, options) {
    return new wms.Overlay(url, options);
};

// Simple AJAX helper (since we can't assume jQuery etc. are present)
function ajax(url, callback) {
    var context = this,
        request = new XMLHttpRequest();
    request.onreadystatechange = change;
    request.open('GET', url);
    request.send();

    function change() {
        if (request.readyState === 4) {
            if (request.status === 200) {
                callback.call(context, request.responseText);
            } else {
                callback.call(context, "error");
            }
        }
    }
}

return wms;

}));
