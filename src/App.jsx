import { useEffect, useState, useRef } from 'react'
import {
    MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, useMap
} from 'react-leaflet'
import L from 'leaflet'
import {
    CloudRain, LayoutDashboard, Map as MapIcon, FileText, Bell,
    Settings, Search, Menu, MapPin, ChevronDown, Droplets, Activity,
    Clock3, ArrowUpRight, MoreHorizontal, CircleCheck, CloudDrizzle,
    X, ExternalLink, LocateFixed, Layers, MessageCircle, Navigation,
    CheckCheck, Trash2, AlertTriangle, Route
} from 'lucide-react'

import './App.css'

// Original six locations remain as the fallback.
const locations = [
    { id: 'anna-nagar', street: 'Anna Nagar 2nd Avenue', area: 'Anna Nagar', lat: 13.085, lng: 80.210 },
    { id: 'tambaram', street: 'Gandhi Road', area: 'Tambaram', lat: 12.924, lng: 80.127 },
    { id: 'velachery', street: 'Velachery Main Road', area: 'Velachery', lat: 12.981, lng: 80.220 },
    { id: 'chromepet', street: 'GST Road', area: 'Chromepet', lat: 12.951, lng: 80.146 },
    { id: 'tnagar', street: 'Pondy Bazaar', area: 'T. Nagar', lat: 13.041, lng: 80.234 },
    { id: 'adyar', street: 'LB Road', area: 'Adyar', lat: 13.001, lng: 80.256 },
]

// Greater Chennai Corporation Region Boundary GeoJSON endpoint.
const CHENNAI_BOUNDARY_URL =
    'https://gisgcc.chennaicorporation.gov.in/server/rest/services/GCCPublic/GCC_AdminBoundary/MapServer/6/query?where=1%3D1&outFields=region&returnGeometry=true&outSR=4326&f=geojson'

const GRID_SPACING_KM = 2
const OPEN_METEO_BATCH_SIZE = 100
const MAX_CONCURRENT_BATCHES = 3
const REFRESH_INTERVAL = 10 * 60 * 1000

// Convert GeoJSON Polygon and MultiPolygon features into polygon arrays.
function getBoundaryPolygons(geojson) {
    const features = geojson?.type === 'FeatureCollection'
        ? geojson.features
        : geojson?.type === 'Feature'
            ? [geojson]
            : [{ geometry: geojson }]

    const polygons = []

    for (const feature of features || []) {
        const geometry = feature?.geometry
        if (!geometry) continue

        if (geometry.type === 'Polygon') {
            polygons.push(geometry.coordinates)
        } else if (geometry.type === 'MultiPolygon') {
            polygons.push(...geometry.coordinates)
        }
    }

    if (!polygons.length) {
        throw new Error('The Chennai boundary did not contain valid polygons.')
    }

    return polygons
}

// Ray-casting point-in-ring test.
// Coordinates use GeoJSON order: [longitude, latitude].
function pointInRing(point, ring) {
    const [x, y] = point
    let inside = false

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]

        const intersects =
            (yi > y) !== (yj > y) &&
            x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.000000001) + xi

        if (intersects) inside = !inside
    }

    return inside
}

// First ring is the outside boundary; remaining rings are holes.
function pointInPolygon(point, polygon) {
    if (!polygon?.length || !pointInRing(point, polygon[0])) {
        return false
    }

    for (let i = 1; i < polygon.length; i++) {
        if (pointInRing(point, polygon[i])) return false
    }

    return true
}

function isInsideChennaiBoundary(lng, lat, polygons) {
    return polygons.some(polygon => pointInPolygon([lng, lat], polygon))
}

// Generate a regular grid and retain only points inside the GCC boundary.
function generateChennaiGrid(polygons) {
    const allCoordinates = polygons.flat(2)

    const longitudes = allCoordinates.map(point => point[0])
    const latitudes = allCoordinates.map(point => point[1])

    const minLng = Math.min(...longitudes)
    const maxLng = Math.max(...longitudes)
    const minLat = Math.min(...latitudes)
    const maxLat = Math.max(...latitudes)

    const middleLat = (minLat + maxLat) / 2
    const latStep = GRID_SPACING_KM / 111.32
    const lngStep =
        GRID_SPACING_KM / (111.32 * Math.cos(middleLat * Math.PI / 180))

    const grid = []
    let row = 0

    for (let lat = minLat; lat <= maxLat; lat += latStep) {
        let col = 0

        for (let lng = minLng; lng <= maxLng; lng += lngStep) {
            if (isInsideChennaiBoundary(lng, lat, polygons)) {
                const number = grid.length + 1

                grid.push({
                    id: `grid-${row}-${col}`,
                    street: `Grid Point ${String(number).padStart(3, '0')}`,
                    area: 'Chennai monitoring grid',
                    lat,
                    lng
                })
            }

            col++
        }

        row++
    }

    if (!grid.length) {
        throw new Error('No monitoring grid points were generated.')
    }

    return grid
}

function weatherDescription(code) {
    if (code === 0) return 'Clear sky'
    if ([1, 2, 3].includes(code)) return 'Mainly clear / cloudy'
    if ([45, 48].includes(code)) return 'Fog'
    if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
    if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
    if ([95, 96, 99].includes(code)) return 'Thunderstorm'
    return 'Weather condition unavailable'
}

function toWeatherRecord(location, payload) {
    const current = payload?.current

    if (!current) {
        throw new Error('Weather response did not include current conditions.')
    }

    const precipitationValues = [
        current.precipitation,
        current.rain
    ].filter(value => value !== null && value !== undefined && Number.isFinite(Number(value)))

    // Missing precipitation must remain Unknown, never be treated as zero.
    const precipitation = precipitationValues.length
        ? Math.max(...precipitationValues.map(Number))
        : null

    const code = Number.isFinite(Number(current.weather_code))
        ? Number(current.weather_code)
        : null

    const isRaining = precipitation === null
        ? null
        : precipitation > 0

    let kind = 'unknown'
    let status = 'Unknown · precipitation unavailable'

    if (isRaining === true) {
        kind = [95, 96, 99].includes(code) ? 'heavy' : 'rain'
        status = `${weatherDescription(code)} · ${precipitation.toFixed(1)} mm`
    } else if (isRaining === false) {
        kind = 'clear'
        status = `No rain · ${precipitation.toFixed(1)} mm`
    }

    return {
        ...location,
        kind,
        status,
        temperature: current.temperature_2m ?? null,
        humidity: current.relative_humidity_2m ?? null,
        precipitation,
        rain: current.rain ?? null,
        wind: current.wind_speed_10m ?? null,
        weatherCode: current.weather_code ?? null,
        observedAt: current.time ?? null,
        fetchedAt: new Date().toISOString(),
        source: 'Open-Meteo',
        isRaining
    }
}

function unknownWeatherRecord(location) {
    return {
        ...location,
        kind: 'unknown',
        status: 'Unknown · data unavailable',
        temperature: null,
        humidity: null,
        precipitation: null,
        rain: null,
        wind: null,
        weatherCode: null,
        observedAt: null,
        fetchedAt: new Date().toISOString(),
        source: 'Open-Meteo',
        isRaining: null
    }
}

// Open-Meteo accepts multiple comma-separated coordinates.
// Failed batches are converted into Unknown records individually.
async function fetchWeatherForLocations(points) {
    const batches = []

    for (let i = 0; i < points.length; i += OPEN_METEO_BATCH_SIZE) {
        batches.push(points.slice(i, i + OPEN_METEO_BATCH_SIZE))
    }

    const records = new Array(points.length)
    let failedPoints = 0
    let nextBatchIndex = 0

    async function worker() {
        while (nextBatchIndex < batches.length) {
            const batchIndex = nextBatchIndex++
            const batch = batches[batchIndex]
            const startIndex = batchIndex * OPEN_METEO_BATCH_SIZE

            try {
                const params = new URLSearchParams({
                    latitude: batch.map(point => point.lat).join(','),
                    longitude: batch.map(point => point.lng).join(','),
                    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code,wind_speed_10m',
                    timezone: 'Asia/Kolkata',
                    forecast_days: '1'
                })

                const response = await fetch(
                    `https://api.open-meteo.com/v1/forecast?${params.toString()}`
                )

                if (!response.ok) {
                    throw new Error(`Open-Meteo returned HTTP ${response.status}`)
                }

                const payload = await response.json()
                const payloads = Array.isArray(payload) ? payload : [payload]

                if (payloads.length !== batch.length) {
                    throw new Error('Weather response count did not match the requested coordinates.')
                }

                payloads.forEach((item, index) => {
                    try {
                        records[startIndex + index] = toWeatherRecord(batch[index], item)
                    } catch {
                        records[startIndex + index] = unknownWeatherRecord(batch[index])
                        failedPoints++
                    }
                })
            } catch (error) {
                console.error(`Weather batch ${batchIndex + 1} failed:`, error)

                batch.forEach((point, index) => {
                    records[startIndex + index] = unknownWeatherRecord(point)
                    failedPoints++
                })
            }
        }
    }

    const workerCount = Math.min(MAX_CONCURRENT_BATCHES, batches.length)

    await Promise.all(
        Array.from({ length: workerCount }, () => worker())
    )

    const knownPoints = records.filter(
        record => record && record.isRaining !== null
    ).length

    return {
        records,
        failedPoints,
        knownPoints
    }
}

const nav = [
    ['Dashboard', LayoutDashboard],
    ['Rainfall Map', MapIcon],
    ['Rainfall Reports', FileText],
    ['Notifications', Bell],
    ['Settings', Settings]
]

const icons = {
    rain: L.divIcon({
        className: 'rain-marker',
        html: '<span class="weather-pin rain">🌧️</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19]
    }),
    heavy: L.divIcon({
        className: 'rain-marker',
        html: '<span class="weather-pin heavy">⛈️</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19]
    }),
    clear: L.divIcon({
        className: 'rain-marker',
        html: '<span class="weather-pin clear">☀️</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19]
    }),
    unknown: L.divIcon({
        className: 'rain-marker',
        html: '<span class="weather-pin unknown">?</span>',
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19]
    })
}

function Recenter() {
    const map = useMap()

    return (
        <button
            className="locate"
            onClick={() => map.setView([13.0827, 80.2707], 12)}
            title="Return to Chennai"
        >
            <LocateFixed size={17} />
        </button>
    )
}

function SearchMapController({ target }) {
    const map = useMap()

    useEffect(() => {
        if (!target) return

        map.setView(
            [target.lat, target.lon],
            Math.max(map.getZoom(), 14),
            { animate: true }
        )
    }, [target, map])

    return null
}

function RouteViewport({ route }) {
    const map = useMap()

    useEffect(() => {
        if (!route?.coordinates?.length) return

        const bounds = L.latLngBounds(
            route.coordinates.map(([lng, lat]) => [lat, lng])
        )

        map.fitBounds(bounds, {
            padding: [45, 45],
            maxZoom: 15,
            animate: true
        })
    }, [route, map])

    return null
}

function MapView({
    onSelect,
    reports,
    loading,
    boundaryPolygons,
    monitoringMode
}) {
    const [sat, setSat] = useState(false)
    const [routeStartText, setRouteStartText] = useState('')
    const [routeDestination, setRouteDestination] = useState('')
    const [startSuggestions, setStartSuggestions] = useState([])
    const [destinationSuggestions, setDestinationSuggestions] = useState([])
    const [selectedStartPlace, setSelectedStartPlace] = useState(null)
    const [selectedDestinationPlace, setSelectedDestinationPlace] = useState(null)
    const [useCurrentLocation, setUseCurrentLocation] = useState(false)
    const [detectedLocation, setDetectedLocation] = useState(null)
    const [locating, setLocating] = useState(false)
    const [routeStart, setRouteStart] = useState(null)
    const [routeResult, setRouteResult] = useState(null)
    const [routeLoading, setRouteLoading] = useState(false)
    const [routeError, setRouteError] = useState('')

    // Debounced Nominatim autocomplete for both route fields.
    useEffect(() => {
        if (useCurrentLocation || routeStartText.trim().length < 3) {
            setStartSuggestions([])
            return
        }

        const controller = new AbortController()

        const timer = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    q: `${routeStartText.trim()}, Chennai, Tamil Nadu, India`,
                    format: 'jsonv2',
                    limit: '5',
                    addressdetails: '1',
                    'accept-language': 'en',
                    countrycodes: 'in'
                })

                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?${params}`,
                    { signal: controller.signal }
                )

                if (!response.ok) throw new Error('Place suggestions unavailable')

                const places = await response.json()

                setStartSuggestions(places.map(place => ({
                    lat: Number(place.lat),
                    lon: Number(place.lon),
                    label: place.display_name,
                    shortLabel: [
                        place.address?.road,
                        place.address?.suburb,
                        place.address?.neighbourhood,
                        place.address?.city_district,
                        place.address?.city || place.address?.town || place.address?.village,
                        place.namedetails?.['name:en']
                    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
                        || 'Chennai location'
                })))
            } catch (error) {
                if (error.name !== 'AbortError') setStartSuggestions([])
            }
        }, 650)

        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [routeStartText, useCurrentLocation])

    useEffect(() => {
        if (routeDestination.trim().length < 3) {
            setDestinationSuggestions([])
            return
        }

        const controller = new AbortController()

        const timer = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    q: `${routeDestination.trim()}, Chennai, Tamil Nadu, India`,
                    format: 'jsonv2',
                    limit: '5',
                    addressdetails: '1',
                    countrycodes: 'in'
                })

                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?${params}`,
                    { signal: controller.signal }
                )

                if (!response.ok) throw new Error('Place suggestions unavailable')

                const places = await response.json()

                setDestinationSuggestions(places.map(place => ({
                    lat: Number(place.lat),
                    lon: Number(place.lon),
                    label: place.display_name,
                    shortLabel: [
                        place.name,
                        place.address?.suburb,
                        place.address?.city_district,
                        place.address?.city
                    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ')
                })))
            } catch (error) {
                if (error.name !== 'AbortError') setDestinationSuggestions([])
            }
        }, 650)

        return () => {
            window.clearTimeout(timer)
            controller.abort()
        }
    }, [routeDestination])

    function getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by this browser.'))
                return
            }
            async function reverseGeocode(coords) {
                const params = new URLSearchParams({
                    lat: String(coords.lat),
                    lon: String(coords.lon),
                    format: 'jsonv2',
                    addressdetails: '1',
                    'accept-language': 'en'
                })

                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?${params}`
                )

                if (!response.ok) {
                    throw new Error('Could not identify your current area.')
                }

                const data = await response.json()
                const address = data.address || {}

                const parts = [
                    address.road,
                    address.suburb,
                    address.neighbourhood,
                    address.city_district,
                    address.city || address.town || address.village
                ].filter(Boolean)

                return [...new Set(parts)].join(', ') || 'Current GPS location'
            }

            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                }),
                error => reject(new Error(
                    error.code === 1
                        ? 'Location permission was denied. Allow location access or enter a starting place.'
                        : 'Could not detect your location. Enter a starting place manually.'
                )),
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 60000
                }
            )
        })
    }

    async function geocodePlace(text) {
        const params = new URLSearchParams({
            q: `${text}, Chennai, Tamil Nadu, India`,
            format: 'jsonv2',
            limit: '1',
            addressdetails: '1',
            namedetails: '1',
            'accept-language': 'en'
        })

        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?${params.toString()}`
        )

        if (!response.ok) {
            throw new Error('Place search is temporarily unavailable. Please try again.')
        }

        const places = await response.json()

        if (!places.length) {
            throw new Error(`Could not find "${text}". Try a nearby street, area, or landmark.`)
        }

        return {
            label: places[0].address
                ? [
                    places[0].address.road,
                    places[0].address.suburb,
                    places[0].address.city_district,
                    places[0].address.city || places[0].address.town
                ].filter(Boolean).join(', ')
                : 'Chennai location'
        }
    }

    async function buildRoute() {
        const destinationText = routeDestination.trim()
        const startText = routeStartText.trim()

        if (!destinationText) {
            setRouteError('Enter a destination.')
            return
        }

        if (!useCurrentLocation && !startText) {
            setRouteError('Enter a starting place or choose Use my location.')
            return
        }

        setRouteLoading(true)
        setRouteError('')
        setRouteResult(null)

        try {
            const start = useCurrentLocation
                ? (detectedLocation || {
                    ...(await getCurrentPosition()),
                    label: 'Current GPS location'
                })
                : (selectedStartPlace || await geocodePlace(startText))
            setRouteStart(start)

            const destination =
                selectedDestinationPlace || await geocodePlace(destinationText)

            const routeResponse = await fetch(
                `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`
            )

            if (!routeResponse.ok) {
                throw new Error('The routing service could not be reached. Please try again.')
            }

            const routeData = await routeResponse.json()
            const bestRoute = routeData.routes?.[0]

            if (routeData.code !== 'Ok' || !bestRoute) {
                throw new Error('No driving route was found between these locations.')
            }

            setRouteResult({
                coordinates: bestRoute.geometry.coordinates,
                distanceKm: bestRoute.distance / 1000,
                durationMinutes: bestRoute.duration / 60,
                destinationLabel: destination.label,
                destination
            })
        } catch (error) {
            setRouteError(error.message || 'Unable to build this route right now.')
        } finally {
            setRouteLoading(false)
        }
    }

    function clearRoute() {
        setRouteResult(null)
        setRouteStart(null)
        setRouteError('')
    }

    return (
        <div className="map-frame">
            <div
                className="route-planner"
                style={{
                    position: 'relative',
                    zIndex: 2,
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                    gap: 12,
                    alignItems: 'start',
                    padding: 14,
                    margin: '10px 0 12px',
                    background: '#fff',
                    border: '1px solid #e7ddf2',
                    borderRadius: 12
                }}
            >
                <div style={{ display: 'grid', gap: 7, minWidth: 0, position: 'relative' }}>
                    <label htmlFor="route-start" style={{ fontSize: 11, color: '#76618e', fontWeight: 700 }}>FROM</label>
                    <input
                        id="route-start"
                        value={
                            useCurrentLocation
                                ? (locating
                                    ? 'Detecting your location...'
                                    : detectedLocation?.label || 'Current GPS location')
                                : routeStartText
                        }
                        onChange={e => {
                            setUseCurrentLocation(false)
                            setSelectedStartPlace(null)
                            setRouteStartText(e.target.value)
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') buildRoute()
                        }}
                        placeholder="Enter starting street or area"
                        aria-label="Route starting point"
                        disabled={useCurrentLocation}
                        style={{
                            width: '100%',
                            minWidth: 0,
                            boxSizing: 'border-box',
                            padding: '10px',
                            border: '1px solid #e4d9ef',
                            borderRadius: 8,
                            color: '#352543',
                            background: useCurrentLocation ? '#f1edf6' : '#fff'
                        }}
                    />

                    {startSuggestions.length > 0 && !useCurrentLocation && (
                        <div
                            role="listbox"
                            aria-label="Starting place suggestions"
                            style={{
                                position: 'absolute',
                                top: 65,
                                left: 0,
                                right: 0,
                                zIndex: 1200,
                                background: '#fff',
                                border: '1px solid #e4d9ef',
                                borderRadius: 8,
                                boxShadow: '0 8px 24px rgba(35,20,50,.14)',
                                overflow: 'hidden'
                            }}
                        >
                            {startSuggestions.map((place, index) => (
                                <button
                                    key={`${place.lat}-${place.lon}-${index}`}
                                    type="button"
                                    role="option"
                                    aria-selected="false"
                                    onClick={() => {
                                        setRouteStartText(place.shortLabel || place.label)
                                        setSelectedStartPlace(place)
                                        setStartSuggestions([])
                                        setRouteError('')
                                    }}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '10px 12px',
                                        textAlign: 'left',
                                        border: 0,
                                        borderBottom: '1px solid #f0eaf5',
                                        background: '#fff',
                                        color: '#352543',
                                        cursor: 'pointer',
                                        fontSize: 12
                                    }}
                                >
                                    <strong style={{ display: 'block' }}>{place.shortLabel || 'Chennai location'}</strong>
                                </button>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        className="route-location-button"
                        disabled={locating}
                        onClick={async () => {
                            if (useCurrentLocation) {
                                setUseCurrentLocation(false)
                                setDetectedLocation(null)
                                setRouteStartText('')
                                setRouteError('')
                                return
                            }

                            setLocating(true)
                            setRouteError('')

                            try {
                                const coords = await getCurrentPosition()

                                let label = 'Current GPS location'

                                try {
                                    label = await reverseGeocode(coords)
                                } catch (error) {
                                    console.warn('Location name unavailable:', error)
                                }

                                setDetectedLocation({
                                    ...coords,
                                    label
                                })

                                setUseCurrentLocation(true)
                                setSelectedStartPlace(null)
                                setStartSuggestions([])
                            } catch (error) {
                                setRouteError(error.message)
                                setUseCurrentLocation(false)
                            } finally {
                                setLocating(false)
                            }
                        }}
                    >
                        {useCurrentLocation
                            ? 'Enter a starting place instead'
                            : locating
                                ? 'Detecting location...'
                                : <><LocateFixed size={13} style={{ verticalAlign: 'middle' }} /> Detect my location</>}
                    </button>
                </div>

                <div style={{ display: 'grid', gap: 7, minWidth: 0, position: 'relative' }}>
                    <label htmlFor="route-destination" style={{ fontSize: 11, color: '#76618e', fontWeight: 700 }}>TO</label>
                    <input
                        id="route-destination"
                        value={routeDestination}
                        onChange={e => {
                            setRouteDestination(e.target.value)
                            setSelectedDestinationPlace(null)
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') buildRoute()
                        }}
                        placeholder="Enter destination"
                        aria-label="Route destination"
                        style={{
                            width: '100%',
                            minWidth: 0,
                            boxSizing: 'border-box',
                            padding: '10px',
                            border: '1px solid #e4d9ef',
                            borderRadius: 8,
                            color: '#352543'
                        }}
                    />

                    {destinationSuggestions.length > 0 && (
                        <div
                            role="listbox"
                            aria-label="Destination suggestions"
                            style={{
                                position: 'absolute',
                                top: 65,
                                left: 0,
                                right: 0,
                                zIndex: 1200,
                                background: '#fff',
                                border: '1px solid #e4d9ef',
                                borderRadius: 8,
                                boxShadow: '0 8px 24px rgba(35,20,50,.14)',
                                overflow: 'hidden'
                            }}
                        >
                            {destinationSuggestions.map((place, index) => (
                                <button
                                    key={`${place.lat}-${place.lon}-${index}`}
                                    type="button"
                                    role="option"
                                    aria-selected="false"
                                    onClick={() => {
                                        setRouteDestination(place.shortLabel || place.label)
                                        setSelectedDestinationPlace(place)
                                        setDestinationSuggestions([])
                                        setRouteError('')
                                    }}
                                    style={{
                                        display: 'block',
                                        width: '100%',
                                        padding: '10px 12px',
                                        textAlign: 'left',
                                        border: 0,
                                        borderBottom: '1px solid #f0eaf5',
                                        background: '#fff',
                                        color: '#352543',
                                        cursor: 'pointer',
                                        fontSize: 12
                                    }}
                                >
                                    <strong style={{ display: 'block' }}>{place.shortLabel || 'Chennai location'}</strong>
                                    <span style={{ color: '#766b80' }}>{place.label}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={buildRoute}
                    disabled={routeLoading}
                    style={{
                        gridColumn: '1 / -1',
                        justifySelf: 'end',
                        padding: '11px 18px',
                        border: 0,
                        borderRadius: 8,
                        background: '#fff000',
                        color: '#241b30',
                        fontWeight: 700,
                        cursor: routeLoading ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {routeLoading ? 'Finding…' : 'Get route'}
                </button>

                {routeError && (
                    <div role="alert" style={{ gridColumn: '1 / -1', color: '#b42318', fontSize: 12 }}>
                        {routeError}
                    </div>
                )}

                {routeResult && (
                    <div
                        style={{
                            gridColumn: '1 / -1',
                            color: '#49365f',
                            fontSize: 12,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 14,
                            alignItems: 'center'
                        }}
                    >
                        <strong>Driving route</strong>
                        <span>{routeResult.distanceKm.toFixed(1)} km</span>
                        <span>{Math.round(routeResult.durationMinutes)} min estimated</span>
                        <button
                            type="button"
                            onClick={clearRoute}
                            style={{
                                border: 0,
                                background: 'transparent',
                                color: '#7650a3',
                                cursor: 'pointer',
                                padding: 0
                            }}
                        >
                            Clear route
                        </button>
                    </div>
                )}
            </div>

            <div className="map-canvas" style={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
                <div className="map-toolbar">
                    <button type="button" className={!sat ? 'chosen' : ''} onClick={() => setSat(false)}>
                        <Layers size={14} /> Map
                    </button>
                    <button type="button" className={sat ? 'chosen' : ''} onClick={() => setSat(true)}>
                        <Navigation size={14} /> Satellite
                    </button>
                </div>

                <MapContainer
                    center={[13.0827, 80.2707]}
                    zoom={11}
                    scrollWheelZoom={false}
                    dragging={true}
                    zoomControl={true}
                    className="leaflet-map"
                >
                    <RouteViewport route={routeResult} />

                    {routeResult && routeStart && (
                        <>
                            <Polyline
                                positions={routeResult.coordinates.map(([lng, lat]) => [lat, lng])}
                                pathOptions={{ color: '#7138b5', weight: 6, opacity: 0.9 }}
                            />
                            <Marker position={[routeStart.lat, routeStart.lon]}>
                                <Popup>
                                    <strong>Starting point</strong><br />
                                    {routeStart.label || 'Your current location'}
                                </Popup>
                            </Marker>
                            <Marker position={[routeResult.destination.lat, routeResult.destination.lon]}>
                                <Popup>
                                    <strong>Destination</strong><br />
                                    {routeDestination}
                                </Popup>
                            </Marker>
                        </>
                    )}

                    {sat
                        ? <TileLayer
                            attribution="Tiles © Esri"
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        />
                        : <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                    }

                    {/* Draw the GCC boundary on the map. */}
                    {boundaryPolygons.map((polygon, index) => (
                        <Polygon
                            key={`boundary-${index}`}
                            positions={polygon.map(ring =>
                                ring.map(([lng, lat]) => [lat, lng])
                            )}
                            pathOptions={{
                                color: '#7138b5',
                                weight: 2,
                                opacity: 0.8,
                                fillColor: '#9b75c9',
                                fillOpacity: 0.035
                            }}
                        />
                    ))}

                    {/* Rainfall monitoring grid markers. */}
                    {reports.map(record => (
                        <Marker
                            key={record.id}
                            position={[record.lat, record.lng]}
                            icon={icons[record.kind] || icons.unknown}
                            eventHandlers={{
                                click: () => onSelect(record.street)
                            }}
                        >
                            <Popup className="rain-glass-popup">
                                <div className="glass-popup-content">
                                    <strong>{record.street}</strong>
                                    <span>{record.area}, Chennai</span>
                                    <span>{record.status}</span>
                                    <small>
                                        {record.temperature == null
                                            ? 'Temperature unavailable'
                                            : `${record.temperature}°C`}
                                        {' · '}Open-Meteo model estimate, not a street sensor
                                    </small>
                                    <small>
                                        Observed: {record.observedAt || 'Unavailable'}
                                    </small>
                                    <small>
                                        Fetched: {record.fetchedAt
                                            ? new Date(record.fetchedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                                            : 'Unavailable'}
                                    </small>
                                </div>
                            </Popup>
                        </Marker>
                    ))}

                    <Recenter />
                </MapContainer>
            </div>

            <div className="map-caption">
                <span className="live-dot" />
                CHENNAI, TAMIL NADU
                <b>
                    {loading
                        ? 'FETCHING WEATHER…'
                        : monitoringMode === 'grid'
                            ? 'CITY-WIDE GRID · OPEN-METEO'
                            : 'SIX-LOCATION FALLBACK · OPEN-METEO'}
                </b>
            </div>
        </div>
    )
}


function ReportModal({ close }) {
    const [category, setCategory] = useState('Light Rain')
    const [note, setNote] = useState('')
    const [location, setLocation] = useState(null)
    const [locationLoading, setLocationLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [sent, setSent] = useState(false)
    const [reportId, setReportId] = useState(null)
    const [error, setError] = useState('')

    function captureLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser.'))
                return
            }

            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                }),
                err => reject(new Error(
                    err.code === 1
                        ? 'Please allow location access to submit your report.'
                        : 'Unable to detect your location. Please try again.'
                )),
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 60000
                }
            )
        })
    }

    async function handleLocation() {
        setLocationLoading(true)
        setError('')

        try {
            const coords = await captureLocation()
            setLocation(coords)
        } catch (err) {
            setError(err.message)
        } finally {
            setLocationLoading(false)
        }
    }

    async function handleSubmit(e) {
        e.preventDefault()
        setSubmitting(true)
        setError('')

        try {
            // Capture GPS automatically if not already detected.
            const coords = location || await captureLocation()

            setLocation(coords)

            const response = await fetch(
                'http://localhost:5000/api/reports',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        category,
                        description: note.trim(),
                        latitude: coords.latitude,
                        longitude: coords.longitude
                    })
                }
            )

            const data = await response.json()

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Report submission failed.')
            }

            setReportId(data.reportId)
            setSent(true)

        } catch (err) {
            setError(err.message || 'Unable to submit your report.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="backdrop" onClick={close}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <div>
                        <small>COMMUNITY CONTRIBUTION</small>
                        <h3>What's happening outside?</h3>
                    </div>
<button
    className="rain-buddy-launcher"
    onClick={() => setNotify(!notify)}
    title="Chat with Rain Buddy"
    aria-label="Chat with Rain Buddy"
>
    <CloudRain size={20} />
    <span>Chat with Rain Buddy</span>
</button>
                </div>

                {sent ? (
                    <div className="success">
                        <CircleCheck size={32} />
                        <h3>Report submitted successfully!</h3>
                        <p>
                            Your community rainfall report has been
                            saved to the RainMap database.
                        </p>
                        <p>Report ID: {reportId}</p>
                        <button className="primary" onClick={close}>
                            Done
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <p>
                            Share what you observe. Your device's GPS
                            coordinates will identify the report location.
                        </p>

                        <label>
                            Rainfall observation
                            <select
                                value={category}
                                onChange={e => setCategory(e.target.value)}
                            >
                                <option value="Heavy Rain">Heavy Rain</option>
                                <option value="Light Rain">Light Rain</option>
                                <option value="No Rain">No Rain</option>
                                <option value="Waterlogging">Waterlogging</option>
                            </select>
                        </label>

                        <label>
                            Report location
                            <button
                                type="button"
                                className="outline full"
                                onClick={handleLocation}
                                disabled={locationLoading}
                            >
                                <MapPin size={16} />
                                {locationLoading
                                    ? 'Detecting location...'
                                    : location
                                        ? 'GPS location captured ✓'
                                        : 'Use my current location'}
                            </button>
                            {location && (
                                <small>
                                    {location.latitude.toFixed(5)},
                                    {' '}{location.longitude.toFixed(5)}
                                </small>
                            )}
                        </label>

                        <label>
                            Optional description
                            <textarea
                                rows="3"
                                maxLength={500}
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                placeholder="Describe the rainfall or waterlogging..."
                            />
                        </label>

                        {error && (
                            <div role="alert" style={{
                                color: '#b42318',
                                fontSize: 13,
                                marginBottom: 12
                            }}>
                                {error}
                            </div>
                        )}

                        <div className="disclaimer">
                            <Clock3 size={14} />
                            Your report will be stored with GPS coordinates
                            and a submission timestamp.
                        </div>

                        <button
                            className="primary"
                            type="submit"
                            disabled={submitting || locationLoading}
                        >
                            <MapPin size={16} />
                            {submitting ? 'Submitting...' : 'Submit rainfall report'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    )
}


export default function App() {
    const [locationDropdownOpen, setLocationDropdownOpen] = useState(false)
    const [userLocation, setUserLocation] = useState(null)

    function useMyLocation() {
        if (!navigator.geolocation) {
            alert('Your browser does not support location access.')
            return
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                setUserLocation({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                })
            },
            () => {
                alert('Please allow location access in your browser.')
            },
            {
                enableHighAccuracy: true,
                timeout: 10000
            }
        )
    }

    const [page, setPage] = useState('Dashboard')
    const [search, setSearch] = useState('')
    const [mobile, setMobile] = useState(false)
    const [report, setReport] = useState(false)
    const [selected, setSelected] = useState('')
    const [notify, setNotify] = useState(false)
    // Rain Buddy AI chat
const [chatMessages, setChatMessages] = useState([
    {
        role: 'assistant',
        text: "Hey! I'm Rain Buddy 🌧️ How can I help you today?"
    }
])
const [chatInput, setChatInput] = useState('')
const [chatLoading, setChatLoading] = useState(false)
const [chatError, setChatError] = useState('')
    // Notification centre
    const [notifications, setNotifications] = useState([])
    const [notificationFilter, setNotificationFilter] = useState('All')
    const [communityReports, setCommunityReports] = useState([])
    const knownReportIds = useRef(new Set())
    const initialReportsLoaded = useRef(false)

    const unreadCount = notifications.filter(
        item => !item.read
    ).length

    const filteredNotifications = notifications.filter(item =>
        notificationFilter === 'All' ||
        item.category === notificationFilter
    )

    const [weatherById, setWeatherById] = useState({})
    const [weatherLoading, setWeatherLoading] = useState(true)
    const [weatherError, setWeatherError] = useState('')
    const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null)

    const [monitoringLocations, setMonitoringLocations] = useState(locations)
    const [monitoringMode, setMonitoringMode] = useState('fallback')
    const [boundaryPolygons, setBoundaryPolygons] = useState([])

    const reports = monitoringLocations.map(location =>
        weatherById[location.id] || unknownWeatherRecord(location)
    )

    const filtered = reports.filter(record =>
        (record.street + ' ' + record.area + ' ' + record.status)
            .toLowerCase()
            .includes(search.toLowerCase())
    )

    const selectedReport = reports.find(record =>
        record.street === selected ||
        record.area.toLowerCase() === selected.toLowerCase()
    )

    const knownReports = reports.filter(record => record.isRaining !== null)
    const rainReports = reports.filter(record => record.isRaining === true)
    const monitoredCount = reports.length

    const knownCount = knownReports.length

    const rainCount = rainReports.length

    const knownPercentage = monitoredCount > 0
        ? (knownCount / monitoredCount) * 100
        : 0

    const rainPercentage = knownCount > 0
        ? (rainCount / knownCount) * 100
        : 0
    function addNotification(notification) {
        setNotifications(current => {
            const existing = current.find(
                item => item.key === notification.key
            )

            // Update an existing alert instead of creating duplicates.
            if (existing) {
                return current.map(item =>
                    item.key === notification.key
                        ? {
                            ...item,
                            ...notification,
                            id: item.id,
                            read: item.read,
                            createdAt: new Date().toISOString()
                        }
                        : item
                )
            }

            return [
                {
                    ...notification,
                    id: `${Date.now()}-${Math.random()}`,
                    read: false,
                    createdAt: new Date().toISOString()
                },
                ...current
            ].slice(0, 50)
        })
    }
    useEffect(() => {
    let cancelled = false

    async function fetchCommunityReports() {
        try {
            const response = await fetch('http://localhost:5000/api/reports')

            if (!response.ok) {
                throw new Error('Failed to fetch community reports')
            }

            const data = await response.json()

            if (!data.success || !Array.isArray(data.reports)) {
                throw new Error('Invalid reports response')
            }

            if (cancelled) return

            setCommunityReports(data.reports)

            // First fetch: remember existing reports only
            if (!initialReportsLoaded.current) {
                data.reports.forEach(report => {
                    knownReportIds.current.add(String(report.id))
                })

                initialReportsLoaded.current = true
                return
            }

            // Later fetches: notify only about new reports
            const newReports = data.reports.filter(report =>
                !knownReportIds.current.has(String(report.id))
            )

            if (newReports.length > 0) {
                newReports.forEach(report => {
                    knownReportIds.current.add(String(report.id))
                })

                newReports.forEach(report => {
                    addNotification({
                        key: `community-report-${report.id}`,
                        category: 'Community Reports',
                        severity: 'warning',
                        title: `New community report: ${report.category}`,
                        message: report.description,
                        location: `${Number(report.latitude).toFixed(4)}, ${Number(report.longitude).toFixed(4)}`,
                        source: 'MySQL Community Reports'
                    })
                })
            }

        } catch (error) {
            console.error('Community reports fetch error:', error)
        }
    }

    fetchCommunityReports()

    const interval = setInterval(fetchCommunityReports, 15000)

    return () => {
        cancelled = true
        clearInterval(interval)
    }
}, [])

    function markAsRead(id) {
        setNotifications(current =>
            current.map(item =>
                item.id === id
                    ? { ...item, read: true }
                    : item
            )
        )
    }

    function markAllAsRead() {
        setNotifications(current =>
            current.map(item => ({ ...item, read: true }))
        )
    }

    function clearNotifications() {
        setNotifications([])
    }
    async function sendChatMessage(e) {
    e?.preventDefault()

    const message = chatInput.trim()

    if (!message || chatLoading) return

    setChatMessages(current => [
        ...current,
        { role: 'user', text: message }
    ])

    setChatInput('')
    setChatLoading(true)
    setChatError('')

    try {
        const response = await fetch('http://localhost:5000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        })

        const data = await response.json()

        if (!response.ok || !data.success) {
            throw new Error(data.message || 'Rain Buddy is unavailable.')
        }

        setChatMessages(current => [
            ...current,
            { role: 'assistant', text: data.reply }
        ])

    } catch (error) {
        setChatError(error.message || 'Unable to connect to Rain Buddy.')
    } finally {
        setChatLoading(false)
    }
}
    // Load the boundary, generate the grid, then fetch weather in batches.
    useEffect(() => {
        let cancelled = false
        let refreshTimer

        async function refreshWeather(points) {
            if (cancelled) return

            setWeatherLoading(true)
            setWeatherError('')

            try {
                const result = await fetchWeatherForLocations(points)
                const rainyPoints = result.records.filter(
                    record => record.isRaining === true
                )

                const thunderstormPoints = rainyPoints.filter(
                    record => [95, 96, 99].includes(Number(record.weatherCode))
                )

                if (rainyPoints.length > 0) {
                    addNotification({
                        key: 'weather-rain-summary',
                        category: 'Rain Alerts',
                        severity: thunderstormPoints.length > 0 ? 'critical' : 'warning',
                        title: thunderstormPoints.length > 0
                            ? 'Thunderstorm conditions detected'
                            : 'Rain detected in monitored areas',
                        message: `${rainyPoints.length} of ${points.length} monitored coordinates currently show precipitation in Open-Meteo data.`,
                        location: 'Chennai monitoring area',
                        source: 'Open-Meteo model estimate'
                    })
                }

                if (result.knownPoints === 0) {
                    addNotification({
                        key: 'weather-data-unavailable',
                        category: 'System',
                        severity: 'warning',
                        title: 'Weather data unavailable',
                        message: 'RainMap could not retrieve valid precipitation readings. Please check again after the next refresh.',
                        location: 'Chennai',
                        source: 'Open-Meteo'
                    })
                }

                if (cancelled) return

                const next = Object.fromEntries(
                    result.records.map(record => [record.id, record])
                )

                setWeatherById(next)
                setWeatherUpdatedAt(new Date())

                if (result.knownPoints === 0) {
                    setWeatherError(
                        'No valid precipitation readings were returned. Locations are marked Unknown.'
                    )
                } else if (result.failedPoints > 0) {
                    setWeatherError(
                        `${result.failedPoints} coordinate(s) could not be fetched or had incomplete data.`
                    )
                } else {
                    setWeatherError('')
                }
            } catch (error) {
                if (cancelled) return

                console.error('Weather refresh failed:', error)
                setWeatherError(
                    'Open-Meteo could not be reached. Check your internet connection.'
                )
            } finally {
                if (!cancelled) setWeatherLoading(false)
            }
        }

        async function initializeMonitoring() {
            let activePoints = locations
            let activeBoundary = []
            let mode = 'fallback'

            try {
                const response = await fetch(CHENNAI_BOUNDARY_URL)

                if (!response.ok) {
                    throw new Error(`Boundary service returned HTTP ${response.status}`)
                }

                const geojson = await response.json()
                activeBoundary = getBoundaryPolygons(geojson)

                const grid = generateChennaiGrid(activeBoundary)

                if (!grid.length) {
                    throw new Error('The Chennai grid was empty.')
                }

                activePoints = grid
                mode = 'grid'
            } catch (error) {
                console.error('Chennai boundary/grid setup failed:', error)
                activePoints = locations
                activeBoundary = []
                mode = 'fallback'
            }

            if (cancelled) return

            setMonitoringLocations(activePoints)
            setBoundaryPolygons(activeBoundary)
            setMonitoringMode(mode)

            await refreshWeather(activePoints)

            if (!cancelled) {
                refreshTimer = window.setInterval(
                    () => refreshWeather(activePoints),
                    REFRESH_INTERVAL
                )
            }
        }

        initializeMonitoring()

        return () => {
            cancelled = true
            if (refreshTimer) window.clearInterval(refreshTimer)
        }
    }, [])

    // Keep the existing scroll-based gradient behavior.
    useEffect(() => {
        const updateGradient = () => {
            const scrollableHeight =
                document.documentElement.scrollHeight - window.innerHeight

            const progress = scrollableHeight > 0
                ? window.scrollY / scrollableHeight
                : 0

            document.documentElement.style.setProperty(
                '--rainmap-gradient-position',
                `${Math.round(progress * 100)}%`
            )
        }

        window.addEventListener('scroll', updateGradient, { passive: true })
        updateGradient()

        return () => {
            window.removeEventListener('scroll', updateGradient)
            document.documentElement.style.removeProperty(
                '--rainmap-gradient-position'
            )
        }
    }, [])

    return (
        <div className="shell">
            {mobile && (
                <button className="overlay" onClick={() => setMobile(false)} />
            )}

            <aside className={`sidebar ${mobile ? 'open' : ''}`}>
                <div className="brand">
                    <div className="brand-icon"><CloudRain size={23} /></div>
                    <div>
                        <h1>RainMap<span>Chennai</span></h1>
                        <small>RAIN AWARENESS STUDIO</small>
                    </div>
                    <button className="close-mobile" onClick={() => setMobile(false)}>
                        <X size={18} />
                    </button>
                </div>

                <div className="nav-label">YOUR WORKSPACE</div>

                <nav>
                    {nav.map(([name, Icon]) => (
                        <button
                            key={name}
                            className={`nav-item ${page === name ? 'active' : ''}`}
                            onClick={() => {
                                setPage(name)
                                setMobile(false)
                            }}
                        >
                            <Icon size={18} />
                            {name}
                            {name === 'Notifications' && unreadCount > 0 && (
                                <i>{unreadCount > 99 ? '99+' : unreadCount}</i>
                            )}
                        </button>
                    ))}
                </nav>

                <div className="side-bottom">
                    <div className="buddy-card">
                        <div className="buddy-icon"><CloudDrizzle size={20} /></div>
                        <small>A LITTLE RAIN CHECK</small>
                        <h3>Plans outside?</h3>
                        <p>Check local reports before you head out. We’ll be honest when data is missing.</p>
                        <button onClick={() => setPage('Rainfall Map')}>
                            Explore the map <ArrowUpRight size={14} />
                        </button>
                    </div>

                    <div className="profile">
                        <div className="avatar">RM</div>
                        <div>
                            <b>RainMap explorer</b>
                            <small>Chennai, Tamil Nadu</small>
                        </div>
                        <MoreHorizontal size={17} />
                    </div>
                </div>
            </aside>

            <main className="main">
                <header className="topbar">
                    <div className="crumb">
                        <button className="mobile-menu" onClick={() => setMobile(true)}>
                            <Menu size={20} />
                        </button>
                        RainMap Studio <span>/</span> <b>{page}</b>
                    </div>

                    <div className="top-actions">
                        <div className="location-wrapper">
                            <button
                                className="location"
                                onClick={() => setLocationDropdownOpen(!locationDropdownOpen)}
                                aria-expanded={locationDropdownOpen}
                            >
                                <MapPin size={15} />
                                Chennai, India
                                <ChevronDown size={13} />
                            </button>

                            {locationDropdownOpen && (
                                <div className="location-dropdown">
                                    <button onClick={() => {
                                        setLocationDropdownOpen(false)
                                        useMyLocation()
                                    }}>
                                        <MapPin size={16} />
                                        <span>
                                            <strong>Use my current location</strong>
                                            <small>Detect location using your device</small>
                                        </span>
                                    </button>

                                    <button onClick={() => {
                                        setLocationDropdownOpen(false)
                                    }}>
                                        <MapPin size={16} />
                                        <span>
                                            <strong>Chennai, India</strong>
                                            <small>Default location</small>
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            className="icon-button"
                            onClick={() => setNotify(!notify)}
                            aria-label="Notifications"
                        >
                            <Bell size={18} />
                            {unreadCount > 0 && <i />}
                        </button>
                    </div>

                    {notify && (
    <div className="rain-buddy-chat">

        <div className="rain-buddy-header">
            <div>
                <div className="rain-buddy-title">
                    <CloudDrizzle size={20} />
                    <div>
                        <strong>Rain Buddy</strong>
                        <small>Your RainMap AI Assistant</small>
                    </div>
                </div>
            </div>

            <button
                className="icon-button"
                onClick={() => setNotify(false)}
                aria-label="Close Rain Buddy"
            >
                <X size={18} />
            </button>
        </div>

        <div className="rain-buddy-messages">
            {chatMessages.map((message, index) => (
                <div
                    key={index}
                    className={`chat-message ${message.role}`}
                >
                    {message.text}
                </div>
            ))}

            {chatLoading && (
                <div className="chat-message assistant">
                    Rain Buddy is thinking...
                </div>
            )}

            {chatError && (
                <div className="chat-error" role="alert">
                    {chatError}
                </div>
            )}
        </div>

        <form
            className="rain-buddy-input"
            onSubmit={sendChatMessage}
        >
            <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Ask Rain Buddy anything..."
                disabled={chatLoading}
            />

            <button
                type="submit"
                disabled={!chatInput.trim() || chatLoading}
                aria-label="Send message"
            >
                <Navigation size={17} />
            </button>
        </form>

    </div>
)}
                </header>

                <div className="content">
                    <div className="welcome">
                        <div>
                            <small className="kicker"><i /> HYPERLOCAL RAIN AWARENESS</small>
                            <h2>{page === 'Dashboard' ? 'RainMap, street by street.' : page}</h2>
                            <p>Local reports, clear timestamps, and no pretending when data is missing.</p>
                        </div>
                        <button className="primary" onClick={() => setReport(true)}>
                            <MapPin size={16} /> Report rain <b>+</b>
                        </button>
                    </div>

                    {page === 'Rainfall Map' && (
                        <section className="panel map-panel">
                            <div className="panel-heading">
                                <div>
                                    <h3>Rainfall Map</h3>
                                    <p>
                                        {monitoringMode === 'grid'
                                            ? `City-wide Chennai monitoring grid · approximately ${GRID_SPACING_KM} km spacing.`
                                            : 'Fallback monitoring using the six selected Chennai locations.'}
                                    </p>
                                </div>
                                <span className="small-status">
                                    {weatherLoading ? 'FETCHING WEATHER' : 'OPEN-METEO ESTIMATES'}
                                </span>
                            </div>

                            <MapView
                                onSelect={setSelected}
                                reports={reports}
                                loading={weatherLoading}
                                boundaryPolygons={boundaryPolygons}
                                monitoringMode={monitoringMode}
                            />

                            <div className="data-note">
                                <Activity size={16} />
                                <span>
                                    Markers use fetched Open-Meteo model estimates.
                                    They are not street-level sensor readings.
                                    {monitoringMode === 'grid' && ' The purple outline represents the loaded GCC boundary.'}
                                </span>
                            </div>
                        </section>
                    )}

                    {page === 'Rainfall Reports' && (
                        <section className="panel table-panel">
                            <div className="panel-heading table-heading">
                                <div>
                                    <h3>Rainfall Reports</h3>
                                    <p>
                                        Current weather estimates fetched from Open-Meteo;
                                        these are not community-submitted reports.
                                    </p>
                                </div>

                                <label className="search-box">
                                    <Search size={17} />
                                    <input
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder="Search locations..."
                                    />
                                </label>
                            </div>

                            <div className="table-wrap">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>LOCATION</th>
                                            <th>REPORT STATUS</th>
                                            <th>TIME</th>
                                            <th>DATA SOURCE</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.map(item => (
                                            <tr key={item.id}>
                                                <td>
                                                    <div className="location-cell">
                                                        <div className="table-pin"><MapPin size={16} /></div>
                                                        <div>
                                                            <strong>{item.street}</strong>
                                                            <span>{item.area}, Chennai</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`status-badge ${item.kind}`}>
                                                        <i /> {item.status}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="time-cell">
                                                        <Clock3 size={14} />
                                                        {item.observedAt
                                                            ? new Date(item.observedAt).toLocaleString('en-IN', {
                                                                timeZone: 'Asia/Kolkata',
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                day: '2-digit',
                                                                month: 'short'
                                                            })
                                                            : 'Unavailable'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="source-cell">{item.source || 'Open-Meteo'}</span>
                                                </td>
                                            </tr>
                                        ))}

                                        {filtered.length === 0 && (
                                            <tr>
                                                <td colSpan="4" className="empty-state">
                                                    No matching locations found.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            <div className="table-footer">
                                <span>Showing {filtered.length} of {reports.length} monitored coordinates</span>
                                <button onClick={() => setSearch('')}>
                                    Clear search <X size={14} />
                                </button>
                            </div>

                            <div className="data-note">
                                <Activity size={16} />
                                <span>
                                    These are weather-model estimates from Open-Meteo,
                                    not verified street observations or community reports.
                                </span>
                            </div>
                        </section>
                    )}
                    {page === 'Notifications' && (
                        <section className="panel notification-panel">
                            <div className="panel-heading">
                                <div>
                                    <h3>Notification Centre</h3>
                                    <p>Rain alerts, community updates and journey notifications.</p>
                                </div>

                                <span className="small-status">
                                    {unreadCount} UNREAD
                                </span>
                            </div>

                            <div className="notification-summary">
                                <article>
                                    <span>Total notifications</span>
                                    <strong>{notifications.length}</strong>
                                </article>

                                <article>
                                    <span>Unread notifications</span>
                                    <strong>{unreadCount}</strong>
                                </article>

                                <article>
                                    <span>Critical alerts</span>
                                    <strong>
                                        {notifications.filter(
                                            item => item.severity === 'critical' && !item.read
                                        ).length}
                                    </strong>
                                </article>
                            </div>

                            <div className="notification-toolbar">
                                <div className="notification-filters">
                                    {[
                                        'All',
                                        'Rain Alerts',
                                        'Community Reports',
                                        'Journey Alerts',
                                        'System'
                                    ].map(filter => (
                                        <button
                                            key={filter}
                                            type="button"
                                            className={
                                                notificationFilter === filter ? 'active' : ''
                                            }
                                            onClick={() => setNotificationFilter(filter)}
                                        >
                                            {filter}
                                        </button>
                                    ))}
                                </div>

                                <div className="notification-actions">
                                    <button
                                        type="button"
                                        onClick={markAllAsRead}
                                        disabled={unreadCount === 0}
                                    >
                                        <CheckCheck size={15} />
                                        Mark all read
                                    </button>

                                    <button
                                        type="button"
                                        onClick={clearNotifications}
                                        disabled={notifications.length === 0}
                                    >
                                        <Trash2 size={15} />
                                        Clear all
                                    </button>
                                </div>
                            </div>

                            <div className="notification-list">
                                {filteredNotifications.length > 0 ? (
                                    filteredNotifications.map(item => (
                                        <article
                                            key={item.id}
                                            className={`notification-card ${item.read ? 'read' : 'unread'} ${item.severity}`}
                                        >
                                            <div className="notification-card-icon">
                                                {item.category === 'Rain Alerts'
                                                    ? <CloudRain size={20} />
                                                    : item.category === 'Journey Alerts'
                                                        ? <Route size={20} />
                                                        : item.category === 'Community Reports'
                                                            ? <MapPin size={20} />
                                                            : <AlertTriangle size={20} />
                                                }
                                            </div>

                                            <div className="notification-card-content">
                                                <div className="notification-card-meta">
                                                    <span className={`notification-severity ${item.severity}`}>
                                                        {item.severity}
                                                    </span>

                                                    <span>{item.category}</span>

                                                    {!item.read && (
                                                        <span className="unread-label">NEW</span>
                                                    )}
                                                </div>

                                                <h4>{item.title}</h4>

                                                <p>{item.message}</p>

                                                <div className="notification-card-footer">
                                                    <span>
                                                        <MapPin size={12} />
                                                        {item.location}
                                                    </span>

                                                    <span>
                                                        <Clock3 size={12} />
                                                        {new Date(item.createdAt).toLocaleString(
                                                            'en-IN',
                                                            {
                                                                timeZone: 'Asia/Kolkata',
                                                                dateStyle: 'medium',
                                                                timeStyle: 'short'
                                                            }
                                                        )}
                                                    </span>
                                                </div>

                                                <small>Source: {item.source}</small>
                                            </div>

                                            <button
                                                type="button"
                                                className="notification-read-button"
                                                onClick={() => markAsRead(item.id)}
                                                disabled={item.read}
                                            >
                                                {item.read ? 'Read' : 'Mark as read'}
                                            </button>
                                        </article>
                                    ))
                                ) : (
                                    <div className="notification-empty">
                                        <div>
                                            <Bell size={24} />
                                        </div>

                                        <h3>
                                            {notifications.length === 0
                                                ? "You're all caught up!"
                                                : 'No notifications in this category'}
                                        </h3>

                                        <p>
                                            {notifications.length === 0
                                                ? 'RainMap will display rainfall alerts and updates here when they become available.'
                                                : 'Try another filter to view your notifications.'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {page === 'Settings' && (
                        <section className="panel">
                            <div className="panel-heading">
                                <div>
                                    <h3>Settings</h3>
                                    <p>RainMap Chennai preferences.</p>
                                </div>
                            </div>

                            <div className="condition-row">
                                <div className="condition-icon rain"><MapPin size={19} /></div>
                                <div className="condition-text">
                                    <strong>Default location</strong>
                                    <span>Chennai, Tamil Nadu, India</span>
                                </div>
                            </div>

                            <div className="condition-row">
                                <div className="condition-icon unknown"><Activity size={19} /></div>
                                <div className="condition-text">
                                    <strong>Weather data source</strong>
                                    <span>Open-Meteo API · refreshes every 10 minutes</span>
                                </div>
                            </div>

                            <div className="condition-row">
                                <div className="condition-icon rain"><MapIcon size={19} /></div>
                                <div className="condition-text">
                                    <strong>Monitoring coverage</strong>
                                    <span>
                                        {monitoringMode === 'grid'
                                            ? `${reports.length} grid coordinates · approximately ${GRID_SPACING_KM} km spacing`
                                            : 'Six fallback Chennai locations'}
                                    </span>
                                </div>
                            </div>

                            <div className="data-note">
                                <Activity size={16} />
                                <span>
                                    Current weather is fetched from Open-Meteo.
                                    Values are model estimates for the selected coordinates,
                                    not confirmed street-level observations.
                                </span>
                            </div>
                        </section>
                    )}


                    {page === 'Dashboard' && (
                        <>
                            {/* Dashboard summary cards */}
                            <div className="stats">
                                <article className="stat lavender">
                                    <div>
                                        Locations monitored
                                        <span><FileText size={18} /></span>
                                    </div>
                                    <h3>
                                        {reports.length.toString().padStart(2, '0')}
                                        <small>{monitoringMode === 'grid' ? 'GRID' : 'FALLBACK'}</small>
                                    </h3>
                                    <p>{knownReports.length} coordinates with valid precipitation data</p>
                                    <div className="stat-progress">
                                        <span style={{ width: `${knownPercentage}%` }} />
                                    </div>
                                </article>

                                <article className="stat chartreuse">
                                    <div>
                                        Rain estimates
                                        <span><MapPin size={18} /></span>
                                    </div>
                                    <h3>
                                        {rainReports.length.toString().padStart(2, '0')}
                                        <small>MODEL</small>
                                    </h3>
                                    <p>Coordinates with precipitation above zero</p>
                                    <div className="stat-progress">
                                        <span style={{ width: `${rainPercentage}%` }} />
                                    </div>
                                </article>

                                <article className="stat white">
                                    <div>
                                        Current rainfall
                                        <span><Droplets size={18} /></span>
                                    </div>
                                    <h3>
                                        {weatherLoading && !knownReports.length
                                            ? '…'
                                            : knownReports.length
                                                ? `${rainReports.length} / ${knownReports.length}`
                                                : '—'}
                                        <small>{weatherLoading ? 'FETCHING' : 'KNOWN'}</small>
                                    </h3>
                                    <p>
                                        {weatherError || 'Rain estimates / coordinates with valid data'}
                                    </p>
                                    <div className="stat-progress">
                                        <span style={{ width: `${knownPercentage}%` }} />
                                    </div>
                                </article>

                                <article className="stat tomato">
                                    <div>
                                        Last API refresh
                                        <span><Activity size={18} /></span>
                                    </div>
                                    <h3>
                                        {weatherUpdatedAt
                                            ? weatherUpdatedAt.toLocaleTimeString('en-IN', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })
                                            : '—'}
                                    </h3>
                                    <p>
                                        {weatherError || (weatherLoading
                                            ? 'Fetching current conditions…'
                                            : 'Source: Open-Meteo model data')}
                                    </p>
                                    <i />
                                </article>
                            </div>

                            {/* Compact current data information */}
                            <section className="panel" style={{ marginTop: 20 }}>
                                <div className="panel-heading">
                                    <div>
                                        <h3>Current Chennai Overview</h3>
                                        <p>
                                            {weatherLoading
                                                ? 'Updating Chennai weather estimates...'
                                                : weatherError
                                                    ? weatherError
                                                    : `${knownReports.length} of ${reports.length} monitoring coordinates currently have valid weather data.`}
                                        </p>
                                    </div>

                                    <span className="small-status">
                                        {weatherLoading ? 'FETCHING' : 'OPEN-METEO'}
                                    </span>
                                </div>

                                <div className="data-note">
                                    <Activity size={16} />
                                    <span>
                                        Rainfall values are Open-Meteo model estimates,
                                        not street-level sensor readings.
                                        Last updated:{' '}
                                        {weatherUpdatedAt
                                            ? weatherUpdatedAt.toLocaleTimeString('en-IN', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })
                                            : 'Not available yet'}
                                    </span>
                                </div>

                                <button
                                    className="outline"
                                    onClick={() => setPage('Rainfall Map')}
                                >
                                    Explore full rainfall map
                                    <ArrowUpRight size={14} />
                                </button>
                            </section>

                            <footer>
                                © 2026 RainMap Chennai
                                <span>
                                    <i />
                                    Weather estimates by Open-Meteo · not street-level sensor data
                                </span>
                            </footer>
                        </>
                    )}

                </div>
            </main>

            {report && <ReportModal close={() => setReport(false)} />}
        </div>
    )
}
