import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { CloudRain, LayoutDashboard, Map as MapIcon, FileText, Bell, Settings, Search, Menu, MapPin, ChevronDown, Droplets, Activity, Clock3, ArrowUpRight, MoreHorizontal, CircleCheck, CloudDrizzle, X, ExternalLink, LocateFixed, Layers, MessageCircle, Navigation } from 'lucide-react'
import './App.css'

const reports = [
    { street: 'Anna Nagar 2nd Avenue', area: 'Anna Nagar', status: 'Rain reported', kind: 'rain', lat: 13.085, lng: 80.210 },
    { street: 'Gandhi Road', area: 'Tambaram', status: 'No rain reported', kind: 'clear', lat: 12.924, lng: 80.127 },
    { street: 'Velachery Main Road', area: 'Velachery', status: 'Heavy rain reported', kind: 'heavy', lat: 12.981, lng: 80.220 },
    { street: 'GST Road', area: 'Chromepet', status: 'Awaiting update', kind: 'unknown', lat: 12.951, lng: 80.146 },
    { street: 'Pondy Bazaar', area: 'T. Nagar', status: 'Awaiting update', kind: 'unknown', lat: 13.041, lng: 80.234 },
    { street: 'LB Road', area: 'Adyar', status: 'Rain reported', kind: 'rain', lat: 13.001, lng: 80.256 },
]
const nav = [['Dashboard', LayoutDashboard], ['Rainfall Map', MapIcon], ['Rainfall Reports', FileText], ['Notifications', Bell], ['Settings', Settings]]

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
function Recenter() { const map = useMap(); return <button className="locate" onClick={() => map.setView([13.0827, 80.2707], 12)} title="Return to Chennai"><LocateFixed size={17} /></button> }

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

function MapView({ onSelect }) {
    const [sat, setSat] = useState(false);
    const [query, setQuery] = useState('');

    const [searchState, setSearchState] = useState({
        loading: false,
        message: '',
        detail: '',
        error: false
    })

    const [target, setTarget] = useState(null)



    async function searchLocation() {
        const term = query.trim()

        if (!term) {
            setSearchState({
                loading: false,
                message: 'Enter a street or area',
                detail: 'Try a Chennai street, neighbourhood, or landmark.',
                error: false
            })
            return
        }

        setSearchState({
            loading: true,
            message: 'Looking for that location…',
            detail: '',
            error: false
        })

        try {
            const params = new URLSearchParams({
                q: `${term}, Chennai, Tamil Nadu, India`,
                format: 'jsonv2',
                limit: '1'
            })

            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?${params}`
            )

            if (!response.ok) {
                throw new Error('Location service unavailable')
            }

            const results = await response.json()

            if (!results.length) {
                setSearchState({
                    loading: false,
                    message: 'We couldn’t locate that place in Chennai.',
                    detail: 'Try a nearby street, neighbourhood, or landmark.',
                    error: true
                })
                return
            }

            const place = results[0]

            const coords = {
                lat: Number(place.lat),
                lon: Number(place.lon)
            }

            setTarget(coords)
            onSelect(term)

            const matchingReport = reports.find(r =>
                `${r.street} ${r.area}`.toLowerCase().includes(term.toLowerCase()) ||
                term.toLowerCase().includes(r.area.toLowerCase())
            )


            setSearchState({
                loading: false,
                message: place.display_name,
                detail: matchingReport
                    ? `A sample record exists for ${matchingReport.street}. It is illustrative, not live rainfall data.`
                    : 'This location has no included rainfall observations yet. Coverage may be added in a future update.',
                error: false
            });

            setTimeout(() => {
                setSearchState({
                    loading: false,
                    message: '',
                    detail: '',
                    error: false
                });
            }, 1000);

        } catch {
            setSearchState({
                loading: false,
                message: 'We couldn’t search for this location right now.',
                detail: 'Check your internet connection and try again. The map itself remains available.',
                error: true
            })
        }
    }

    return <div className="map-frame">

        <div className="map-search">
            <Search size={17} />

            <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter') searchLocation()
                }}
                placeholder="Search a street or area…"
                aria-label="Search a street or area"
            />

            <button
                type="button"
                onClick={searchLocation}
                disabled={searchState.loading}
                aria-label="Search location"
            >
                <Search size={16} />
            </button>
        </div>

        {searchState.message && (
            <div
                className={`location-feedback ${searchState.error ? 'error' : ''}`}
                role="status"
                aria-live="polite"
            >
                <strong>
                    {searchState.loading ? 'Searching…' : searchState.message}
                </strong>

                {searchState.detail && (
                    <small>{searchState.detail}</small>
                )}
            </div>
        )}

        <div className="map-toolbar"><button className={!sat ? 'chosen' : ''} onClick={() => setSat(false)}><Layers size={14} /> Map</button><button className={sat ? 'chosen' : ''} onClick={() => setSat(true)}><Navigation size={14} /> Satellite</button></div>
        
<MapContainer
    center={[13.0827, 80.2707]}
    zoom={11}
    scrollWheelZoom={false}
    dragging={true}
    zoomControl={true}
    className="leaflet-map"
>
<SearchMapController target={target} />
            {sat ? <TileLayer attribution="Tiles © Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" /> : <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />}
            {reports.map(r => <Marker key={r.street} position={[r.lat, r.lng]} icon={icons[r.kind]} eventHandlers={{ click: () => onSelect(r.street) }}>
                <Popup className="rain-glass-popup">
                    <div className="glass-popup-content">
                        <strong>{r.street}</strong>
                        <span>{r.area}, Chennai</span>
                        <span>{r.status}</span>
                        <small>Illustrative demo data — not live</small>
                    </div>
                </Popup>
            </Marker>)}
            <Recenter />
        </MapContainer><div className="map-caption"><span className="live-dot" /> CHENNAI, TAMIL NADU <b>DEMO DATA ONLY</b></div></div>
}
function ReportModal({ close }) { const [area, setArea] = useState('Anna Nagar'); const [status, setStatus] = useState('Rain observed'); const [note, setNote] = useState(''); const [sent, setSent] = useState(false); return <div className="backdrop" onClick={close}><div className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><div><small>COMMUNITY CONTRIBUTION</small><h3>What’s happening outside?</h3></div><button className="icon-button" onClick={close}><X size={18} /></button></div>{sent ? <div className="success"><CircleCheck size={32} /><h3>Demo report prepared</h3><p>Your report for {area} is only a prototype. It has not been published or saved to a server.</p><button className="primary" onClick={close}>Got it</button></div> : <form onSubmit={e => { e.preventDefault(); setSent(true) }}><p>This form demonstrates the future report flow. It does not publish live reports.</p><label>Area<select value={area} onChange={e => setArea(e.target.value)}>{['Anna Nagar', 'Tambaram', 'Velachery', 'Chromepet', 'T. Nagar', 'Adyar', 'Other Chennai area'].map(x => <option key={x}>{x}</option>)}</select></label><label>Observation<select value={status} onChange={e => setStatus(e.target.value)}>{['Rain observed', 'Heavy rain observed', 'No rain observed', 'Unable to confirm'].map(x => <option key={x}>{x}</option>)}</select></label><label>Optional note<textarea rows="3" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a short description…" /></label><div className="disclaimer"><Clock3 size={14} /> A real version should attach time and approximate location.</div><button className="primary" type="submit"><MapPin size={16} /> Preview demo report</button></form>}</div></div> }
export default function App() {
 const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);
const [userLocation, setUserLocation] = useState(null);

function useMyLocation() {
    if (!navigator.geolocation) {
        alert("Your browser does not support location access.");
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            setUserLocation({
                lat: position.coords.latitude,
                lon: position.coords.longitude
            });
        },
        () => {
            alert("Please allow location access in your browser.");
        },
        {
            enableHighAccuracy: true,
            timeout: 10000
        }
    );
}

    const [page, setPage] = useState('Dashboard'); const [search, setSearch] = useState(''); const [mobile, setMobile] = useState(false); const [report, setReport] = useState(false); const [selected, setSelected] = useState(''); const [notify, setNotify] = useState(false); const filtered = reports.filter(r => (r.street + ' ' + r.area + ' ' + r.status).toLowerCase().includes(search.toLowerCase())); const selectedReport = reports.find(r => r.street === selected || r.area.toLowerCase() === selected.toLowerCase());


    useEffect(() => {
        const updateGradient = () => {
            const scrollableHeight =
                document.documentElement.scrollHeight - window.innerHeight;

            const progress =
                scrollableHeight > 0
                    ? window.scrollY / scrollableHeight
                    : 0;

            // Move the gradient from 0% to 100% as you scroll.
            document.documentElement.style.setProperty(
                "--rainmap-gradient-position",
                `${Math.round(progress * 100)}%`
            );
        };

        window.addEventListener("scroll", updateGradient, {
            passive: true,
        });

        updateGradient();

        return () => {
            window.removeEventListener("scroll", updateGradient);
            document.documentElement.style.removeProperty(
                "--rainmap-gradient-position"
            );
        };
    }, []);

    return <div className="shell">{mobile && <button className="overlay" onClick={() => setMobile(false)} />}<aside className={`sidebar ${mobile ? 'open' : ''}`}><div className="brand"><div className="brand-icon"><CloudRain size={23} /></div><div><h1>RainMap<span>Chennai</span></h1><small>RAIN AWARENESS STUDIO</small></div><button className="close-mobile" onClick={() => setMobile(false)}><X size={18} /></button></div><div className="nav-label">YOUR WORKSPACE</div><nav>{nav.map(([name, Icon]) => <button key={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => { setPage(name); setMobile(false) }}><Icon size={18} />{name}{name === 'Notifications' && <i>2</i>}</button>)}</nav><div className="side-bottom"><div className="buddy-card"><div className="buddy-icon"><CloudDrizzle size={20} /></div><small>A LITTLE RAIN CHECK</small><h3>Plans outside?</h3><p>Check local reports before you head out. We’ll be honest when data is missing.</p><button onClick={() => setPage('Rainfall Map')}>Explore the map <ArrowUpRight size={14} /></button></div><div className="profile"><div className="avatar">RM</div><div><b>RainMap explorer</b><small>Chennai, Tamil Nadu</small></div><MoreHorizontal size={17} /></div></div></aside>
        <main className="main"><header className="topbar"><div className="crumb"><button className="mobile-menu" onClick={() => setMobile(true)}><Menu size={20} /></button>RainMap Studio <span>/</span> <b>{page}</b></div><div className="top-actions">

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
            <button
                onClick={() => {
                    setLocationDropdownOpen(false);
                    useMyLocation();
                }}
            >
                <MapPin size={16} />
                <span>
                    <strong>Use my current location</strong>
                    <small>Detect location using your device</small>
                </span>
            </button>

            <button
                onClick={() => {
                    setLocationDropdownOpen(false);
                    // Return to the default Chennai map view here.
                }}
            >
                <MapPin size={16} />
                <span>
                    <strong>Chennai, India</strong>
                    <small>Default location</small>
                </span>
            </button>
        </div>
    )}
</div>

<button className="icon-button" onClick={() => setNotify(!notify)} aria-label="Notifications"><Bell size={18} /><i /></button></div>{notify && <div className="notification"><b><MessageCircle size={16} /> RainBuddy says…</b><p>Hey! This is demo mode, so I don’t have verified live rain data yet.</p><p>Want to help test the idea? Add a sample report.</p><button onClick={() => { setNotify(false); setReport(true) }}>Add demo report <ArrowUpRight size={14} /></button></div>}</header>
            <div className="content"><div className="welcome"><div><small className="kicker"><i /> HYPERLOCAL RAIN AWARENESS</small><h2>{page === 'Dashboard' ? 'RainMap, street by street.' : page}</h2><p>Local reports, clear timestamps, and no pretending when data is missing.</p></div><button className="primary" onClick={() => setReport(true)}><MapPin size={16} /> Report rain <b>+</b></button></div>
                {page !== 'Dashboard' && <div className="notice"><Activity size={18} /><div><b>{page} preview</b><p>This section is still a prototype. Dashboard and demo report form are available.</p></div><button onClick={() => setPage('Dashboard')}>Back to dashboard</button></div>}
                <div className="stats"><article className="stat lavender"><div>Sample reports <span><FileText size={18} /></span></div><h3>06 <small>DEMO</small></h3><p>Illustrative records only</p><i /></article><article className="stat chartreuse"><div>Areas on sample map <span><MapPin size={18} /></span></div><h3>06 <small>AREAS</small></h3><p>Not a live Chennai count</p><i /></article><article className="stat white"><div>Live rainfall <span><Droplets size={18} /></span></div><h3>— <small>NOT CONNECTED</small></h3><p>No live weather feed connected</p><i /></article><article className="stat tomato"><div>Data confidence <span><Activity size={18} /></span></div><h3>Unknown</h3><p>Sample reports are not verified</p><i /></article></div>
                <section className="main-grid"><article className="panel map-panel"><div className="panel-head"><div><small>THE CITY, IN VIEW</small><h3>RainLines map <b>DEMO</b></h3><p>Tap a marker to inspect its sample report.</p></div><button className="outline" onClick={() => setPage('Rainfall Map')}>Open map <ExternalLink size={13} /></button></div><MapView onSelect={setSelected} /><div className="legend"><span><i className="lr" /> Rain reported · demo</span><span><i className="lh" /> Heavy rain · demo</span><span><i className="lc" /> No rain reported · demo</span><span><i className="lu" /> Unknown</span></div>{selectedReport && <div className="selected"><div><small>SELECTED SAMPLE LOCATION</small><b>{selectedReport.street}</b><span>{selectedReport.area} · {selectedReport.status}</span></div><button onClick={() => setSelected('')}><X size={15} /></button></div>}</article>
                    <article className="panel overview"><div className="panel-head"><div><small>WHAT WE KNOW</small><h3>Report overview</h3><p>Example records — not current conditions.</p></div><b className="demo">SAMPLE</b></div><div className="conditions"><div><span className="condition-icon rain"><CloudRain size={18} /></span><section><b>Rain reported</b><small>Anna Nagar · demo</small></section><strong>01</strong></div><div><span className="condition-icon heavy"><Droplets size={18} /></span><section><b>Heavy rain reported</b><small>Velachery · demo</small></section><strong>01</strong></div><div><span className="condition-icon clear"><CircleCheck size={18} /></span><section><b>No rain reported</b><small>Tambaram · demo</small></section><strong>01</strong></div><div><span className="condition-icon unknown"><Clock3 size={18} /></span><section><b>Insufficient data</b><small>Other sample locations</small></section><strong>03</strong></div></div><div className="buddy-note"><MessageCircle size={17} /><p><b>RainBuddy</b><br />“I’d rather say ‘I don’t know yet’ than send you out with a guess.”</p></div><button className="outline full" onClick={() => setReport(true)}>Share what you see <ArrowUpRight size={14} /></button></article></section>
                <section className="panel table-panel"><div className="panel-head table-head"><div><small>COMMUNITY SIGNALS</small><h3>Recent observation samples</h3><p>Search and inspect illustrative locations.</p></div><label className="table-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search streets or areas…" /></label></div><div className="table-wrap"><table><thead><tr><th>LOCATION</th><th>STATUS</th><th>TIME</th><th>SOURCE</th><th /></tr></thead><tbody>{filtered.map(r => <tr key={r.street}><td><div className="loc-cell"><span><MapPin size={15} /></span><div><b>{r.street}</b><small>{r.area}, Chennai</small></div></div></td><td><label className={`status ${r.kind}`}><i />{r.status}</label></td><td><span className="time"><Clock3 size={13} /> Sample</span></td><td>Demo record</td><td><button className="row-more" onClick={() => setSelected(r.street)} title="Select location"><ArrowUpRight size={16} /></button></td></tr>)}{!filtered.length && <tr><td colSpan="5" className="empty">No matching sample locations.</td></tr>}</tbody></table></div><div className="table-footer">Showing {filtered.length} of {reports.length} sample records <button onClick={() => setSearch('')}>Clear search <X size={13} /></button></div></section><footer>© 2026 RainMap Chennai <span><i /> Prototype · sample data only</span></footer></div></main>{report && <ReportModal close={() => setReport(false)} />}</div>
}
