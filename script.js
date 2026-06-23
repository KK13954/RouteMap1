/*
	Driveria mockup script
	一行だけ編集して `MAPS_API_KEY` にご自身の Google Maps API Key を設定してください。
*/
const MAPS_API_KEY = "AIzaSyAHf84f7w_OrzWnPx0VWRtMlx3oQy5mADM";

// デフォルト出発地：東京学芸大学
const DEFAULT_ORIGIN_TEXT = "東京学芸大学";
const DEFAULT_ORIGIN_COORD = { lat: 35.705499, lng: 139.491803 };

let map;
let directionsService;
let placesService;
let geocoder;
let routePolyline = null;
let markers = [];
let infoWindows = [];
let currentGridSizeMeters = null;
let gridLines = [];

// DOM
const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const generateBtn = document.getElementById('generate');
const totalDistanceEl = document.getElementById('total-distance');
const totalDurationEl = document.getElementById('total-duration');
const gridSizeEl = document.getElementById('grid-size');
const cpListEl = document.getElementById('cp-list');
const messagesEl = document.getElementById('messages');
const splitSelect = document.getElementById('split-count');
const gridToggle = document.getElementById('toggle-grid');

function showMessage(msg, isError = false) {
	messagesEl.textContent = msg;
	messagesEl.style.color = isError ? '#b00020' : '#0b6b0b';
	console[isError ? 'error' : 'log'](msg);
}

function clearMessage(){ messagesEl.textContent = ''; }

function loadGoogleMapsApi() {
	return new Promise((resolve, reject) => {
		if (!MAPS_API_KEY || MAPS_API_KEY === 'YOUR_API_KEY_HERE') {
			const msg = 'エラー: MAPS_API_KEY を script.js の先頭で設定してください。';
			showMessage(msg, true);
			reject(new Error(msg));
			return;
		}

		// グローバルコールバックを定義
		window.initMap = function() {
			resolve();
		};

		const script = document.createElement('script');
		script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_API_KEY)}&libraries=places,geometry&callback=initMap`;
		script.async = true;
		script.defer = true;
		script.onerror = () => {
			const msg = 'Google Maps API の読み込みに失敗しました。APIキーを確認してください。';
			showMessage(msg, true);
			reject(new Error(msg));
		};
		document.head.appendChild(script);
	});
}

function initApp() {
	// 初期入力値
	originInput.value = DEFAULT_ORIGIN_TEXT;

	// 地図初期化
	map = new google.maps.Map(document.getElementById('map'), {
		center: DEFAULT_ORIGIN_COORD,
		zoom: 12,
		streetViewControl: false,
		mapTypeControl: false,
	});

	directionsService = new google.maps.DirectionsService();
	placesService = new google.maps.places.PlacesService(map);
	geocoder = new google.maps.Geocoder();

	// Autocomplete
	const originAuto = new google.maps.places.Autocomplete(originInput, { fields: ['place_id','geometry','formatted_address','name'] });
	const destAuto = new google.maps.places.Autocomplete(destinationInput, { fields: ['place_id','geometry','formatted_address','name'] });

	originAuto.addListener('place_changed', () => {
		const place = originAuto.getPlace();
		if (place && place.geometry && place.geometry.location) {
			map.panTo(place.geometry.location);
			map.setZoom(13);
		}
	});

	destAuto.addListener('place_changed', () => {
		const place = destAuto.getPlace();
		if (place && place.geometry && place.geometry.location) {
			map.panTo(place.geometry.location);
			map.setZoom(13);
		}
	});

	generateBtn.addEventListener('click', onGenerateRoute);
}

function clearMapOverlays(){
	if (routePolyline) { routePolyline.setMap(null); routePolyline = null; }
	markers.forEach(m => m.setMap(null)); markers = [];
	infoWindows.forEach(iw => iw.close()); infoWindows = [];
	cpListEl.innerHTML = '';
}

function onGenerateRoute(){
	clearMessage();
	clearMapOverlays();

	const originText = originInput.value.trim();
	const destText = destinationInput.value.trim();
	if (!originText || !destText) { showMessage('出発地と目的地を両方入力してください。', true); return; }

	showMessage('ルートを取得しています…');

	directionsService.route({
		origin: originText,
		destination: destText,
		travelMode: google.maps.TravelMode.DRIVING,
		provideRouteAlternatives: false,
	}, (result, status) => {
		if (status !== 'OK' || !result || !result.routes || result.routes.length === 0) {
			showMessage('ルート取得に失敗しました: ' + status, true);
			return;
		}

		try {
			handleDirectionsResult(result.routes[0]);
		} catch (err) {
			showMessage('ルート処理中にエラーが発生しました: ' + err.message, true);
			console.error(err);
		}
	});
}

function handleDirectionsResult(route){
	const overviewPath = route.overview_path.slice(); // array of LatLng

	// 総距離（m）と総時間（秒）
	let totalDistanceMeters = 0;
	let totalDurationSec = 0;
	route.legs.forEach(leg => {
		if (leg.distance && leg.distance.value) totalDistanceMeters += leg.distance.value;
		if (leg.duration && leg.duration.value) totalDurationSec += leg.duration.value;
	});

	// Fallback: overview path cumulative calculation if totalDistanceMeters is zero
	if (totalDistanceMeters === 0 && overviewPath.length > 1) {
		for (let i = 1; i < overviewPath.length; i++) {
			totalDistanceMeters += google.maps.geometry.spherical.computeDistanceBetween(overviewPath[i-1], overviewPath[i]);
		}
	}

	const totalDistanceKm = (totalDistanceMeters/1000).toFixed(2) + ' km';
	const totalDurationMin = Math.round(totalDurationSec/60) + ' 分';
	totalDistanceEl.textContent = totalDistanceKm;
	totalDurationEl.textContent = totalDurationMin;

	// 動的グリッドサイズ（総予定距離の1% をメートルで、50m〜3000m にクランプ）
	let gridSize = Math.round(totalDistanceMeters * 0.01);
	gridSize = Math.max(50, Math.min(3000, gridSize));
	gridSizeEl.textContent = gridSize + ' m';

	// Draw polyline
	routePolyline = new google.maps.Polyline({
		path: overviewPath,
		strokeColor: '#1E88E5',
		strokeWeight: 6,
		map: map,
		clickable: false,
	});

	// Fit map
	const bounds = new google.maps.LatLngBounds();
	overviewPath.forEach(p => bounds.extend(p));
	map.fitBounds(bounds);

	// Compute cumulative distances along overviewPath
	const cumulative = [0];
	for (let i = 1; i < overviewPath.length; i++) {
		const d = google.maps.geometry.spherical.computeDistanceBetween(overviewPath[i-1], overviewPath[i]);
		cumulative.push(cumulative[i-1] + d);
	}
	const totalCumulative = cumulative[cumulative.length - 1] || totalDistanceMeters;

		// Targets: choose split count based on UI (supports 4,5,10 and general cases)
		let splitCount = 4;
		if (splitSelect) {
			const v = parseInt(splitSelect.value, 10);
			if (!isNaN(v) && v >= 2) splitCount = v;
		}
		// generate ratios as (1/splitCount, 2/splitCount, ..., (splitCount-1)/splitCount)
		const ratios = Array.from({ length: Math.max(0, splitCount - 1) }, (_, i) => (i + 1) / splitCount);
		const targets = ratios.map(r => ({ ratio: r, dist: r * totalCumulative }));

	// For each target, compute exact point along the polyline (interpolate between segment endpoints)
	const candidatePromises = targets.map(t => {
		let idx = cumulative.findIndex(c => c >= t.dist);
		if (idx === -1) idx = overviewPath.length - 1;

		let candidateLatLng;
		if (idx === 0) {
			candidateLatLng = overviewPath[0];
		} else {
			const segStart = overviewPath[idx-1];
			const segEnd = overviewPath[idx];
			const segDist = cumulative[idx] - cumulative[idx-1];
			const remain = t.dist - cumulative[idx-1];
			const frac = segDist > 0 ? (remain / segDist) : 0;
			// interpolate using geometry.spherical.interpolate for accuracy
			candidateLatLng = google.maps.geometry.spherical.interpolate(segStart, segEnd, frac);
		}

		return snapToInfrastructure(candidateLatLng).then(snapped => ({ ratio: t.ratio, candidate: candidateLatLng, snapped }));
	});

	Promise.all(candidatePromises).then(results => {
		// Place origin and destination markers
		placeSimpleMarker(overviewPath[0], '出発地', '#1976d2');
		placeSimpleMarker(overviewPath[overviewPath.length-1], '目的地', '#2e7d32');

		results.forEach((res, i) => {
			const ratio = res.ratio;
			const cp = res.snapped;
			const etaMin = Math.max(1, Math.round((totalDurationSec * ratio) / 60));

			const name = cp.name || `チェックポイント ${i+1}`;
			const latlng = cp.location;

			const marker = placeNumberedMarker(latlng, i+1);
			const info = new google.maps.InfoWindow({ content: `<div style="min-width:200px"><strong>${escapeHtml(name)}</strong><div>緯度経度: ${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)}</div><div>ETA: ${etaMin} 分</div></div>` });
			marker.addListener('click', () => { info.open(map, marker); });
			markers.push(marker);
			infoWindows.push(info);

			// Add card
			const card = document.createElement('div');
			card.className = 'cp-card';
			card.innerHTML = `<div class="cp-title">CP${i+1}: ${escapeHtml(name)}</div><div class="cp-meta">${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)} — ETA ${etaMin} 分</div>`;
			card.addEventListener('click', () => {
				map.panTo(latlng);
				map.setZoom(15);
				info.open(map, marker);
			});
			cpListEl.appendChild(card);
		});

		// store current grid size in meters for toggling grid
		currentGridSizeMeters = gridSize;
		if (gridToggle && gridToggle.checked) drawGridOnMap(currentGridSizeMeters);
		clearMessage();
	}).catch(err => {
		showMessage('チェックポイント抽出中にエラーが発生しました: ' + err.message, true);
		console.error(err);
	});
}

	function clearGrid() {
		gridLines.forEach(line => line.setMap(null));
		gridLines = [];
	}

	function drawGridOnMap(sizeMeters) {
		clearGrid();
		if (!sizeMeters || sizeMeters <= 0) return;
		if (!map || !map.getBounds) return;
		const bounds = map.getBounds();
		if (!bounds) return;

		const sw = bounds.getSouthWest();
		const ne = bounds.getNorthEast();

		// compute total width (east-west) at south latitude and total height (north-south)
		const sw_e = new google.maps.LatLng(sw.lat(), ne.lng());
		const se = sw_e;
		const nw = new google.maps.LatLng(ne.lat(), sw.lng());

		const totalWidth = google.maps.geometry.spherical.computeDistanceBetween(sw, se);
		const totalHeight = google.maps.geometry.spherical.computeDistanceBetween(sw, nw);

		const cols = Math.ceil(totalWidth / sizeMeters);
		const rows = Math.ceil(totalHeight / sizeMeters);

		// draw vertical lines
		for (let i = 0; i <= cols; i++) {
			const eastOffset = i * sizeMeters;
			const start = google.maps.geometry.spherical.computeOffset(sw, eastOffset, 90);
			const end = google.maps.geometry.spherical.computeOffset(start, totalHeight, 0);
			const line = new google.maps.Polyline({ path: [start, end], strokeColor: '#777777', strokeOpacity: 0.9, strokeWeight: 2, map });
			gridLines.push(line);
		}

		// draw horizontal lines
		for (let j = 0; j <= rows; j++) {
			const northOffset = j * sizeMeters;
			const start = google.maps.geometry.spherical.computeOffset(sw, northOffset, 0);
			const end = google.maps.geometry.spherical.computeOffset(start, totalWidth, 90);
			const line = new google.maps.Polyline({ path: [start, end], strokeColor: '#777777', strokeOpacity: 0.9, strokeWeight: 2, map });
			gridLines.push(line);
		}
	}

	// grid toggle listener
	if (gridToggle) {
		gridToggle.addEventListener('change', () => {
			if (gridToggle.checked) {
				if (currentGridSizeMeters) drawGridOnMap(currentGridSizeMeters);
			} else {
				clearGrid();
			}
		});
	}

function placeSimpleMarker(latlng, title, color){
	const marker = new google.maps.Marker({ position: latlng, map: map, title, icon: makeCircleIcon(color) });
	markers.push(marker);
	const iw = new google.maps.InfoWindow({ content: `<div><strong>${escapeHtml(title)}</strong><div>${latlng.lat().toFixed(6)}, ${latlng.lng().toFixed(6)}</div></div>` });
	marker.addListener('click', () => iw.open(map, marker));
	infoWindows.push(iw);
}

function placeNumberedMarker(latlng, number){
	return new google.maps.Marker({ position: latlng, map: map, icon: makeNumberIcon(number) });
}

function makeCircleIcon(color){
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><circle cx='18' cy='18' r='10' fill='${color}'/></svg>`;
	return { url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(36,36) };
}

function makeNumberIcon(number){
	const colors = ['#ff7043','#ffa726','#66bb6a'];
	const color = colors[(number-1) % colors.length];
	const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='48' height='64' viewBox='0 0 48 64'><path d='M24 0c-7.732 0-14 6.268-14 14 0 11.02 14 28 14 28s14-16.98 14-28C38 6.268 31.732 0 24 0z' fill='${color}'/><text x='24' y='26' font-size='16' font-family='Arial' font-weight='700' text-anchor='middle' fill='#fff'>${number}</text></svg>`;
	return { url: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(36,48), anchor: new google.maps.Point(18,48) };
}

function snapToInfrastructure(candidateLatLng) {
	// 半径500mで優先タイプ順に検索して、経路にもっとも近い施設を返す
	return new Promise(async (resolve, reject) => {
		const radius = 250;

		function nearbySearchPromise(request) {
			return new Promise(res => {
				placesService.nearbySearch(request, (results, status) => {
					res({ results: results || [], status });
				});
			});
		}

		// 優先順: 高速道路インフラ系キーワード -> 駅 -> ガソリン -> コンビニ(優先) -> レストラン（カフェも同扱いだがレストラン優先） -> 商業施設 -> 汎用establishment
		const checks = [
			{ type: null, keyword: 'インターチェンジ|サービスエリア|PA|SA|JCT' },
			{ type: 'transit_station' },
			{ type: 'gas_station' },
			{ type: 'convenience_store' },
			{ type: 'restaurant' },
			{ type: 'cafe' },
			{ type: 'shopping_mall' },
			{ type: 'establishment' }
		];

		try {
			for (const chk of checks) {
				const req = { location: candidateLatLng, radius };
				if (chk.type) req.type = chk.type;
				if (chk.keyword) req.keyword = chk.keyword;

				const { results, status } = await nearbySearchPromise(req);
				if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
					// 候補点に近い順にソート
					results.sort((a, b) => {
						const da = google.maps.geometry.spherical.computeDistanceBetween(candidateLatLng, a.geometry.location);
						const db = google.maps.geometry.spherical.computeDistanceBetween(candidateLatLng, b.geometry.location);
						return da - db;
					});

					// 最も近いものを採用
					const chosen = results[0];
					resolve({ location: chosen.geometry.location, name: chosen.name });
					return;
				}
			}

			// レストラン／カフェが見つかりにくいことを考慮して、優先検索で見つからなければ半径を拡大して再検索
			const { results: broaderResults, status: broaderStatus } = await nearbySearchPromise({ location: candidateLatLng, radius: 500, keyword: 'restaurant|cafe' });
			if (broaderStatus === google.maps.places.PlacesServiceStatus.OK && broaderResults && broaderResults.length > 0) {
				// 優先度: restaurant > cafe > others, その後で距離優先
				broaderResults.sort((a, b) => {
					const typesA = a.types || [];
					const typesB = b.types || [];
					const prioA = (typesA.includes('restaurant') ? 2 : (typesA.includes('cafe') ? 1 : 0));
					const prioB = (typesB.includes('restaurant') ? 2 : (typesB.includes('cafe') ? 1 : 0));
					if (prioA !== prioB) return prioB - prioA; // higher priority first
					const da = google.maps.geometry.spherical.computeDistanceBetween(candidateLatLng, a.geometry.location);
					const db = google.maps.geometry.spherical.computeDistanceBetween(candidateLatLng, b.geometry.location);
					return da - db;
				});
				const chosen = broaderResults[0];
				resolve({ location: chosen.geometry.location, name: chosen.name });
				return;
			}

			// どのタイプでも見つからなかった -> 逆ジオコーディングで住所を返す
			geocoder.geocode({ location: candidateLatLng }, (geoResults, geoStatus) => {
				if (geoStatus === 'OK' && geoResults && geoResults[0]) {
					resolve({ location: candidateLatLng, name: geoResults[0].formatted_address });
				} else {
					resolve({ location: candidateLatLng, name: '未設定地点' });
				}
			});
		} catch (err) {
			geocoder.geocode({ location: candidateLatLng }, (geoResults, geoStatus) => {
				if (geoStatus === 'OK' && geoResults && geoResults[0]) {
					resolve({ location: candidateLatLng, name: geoResults[0].formatted_address });
				} else {
					resolve({ location: candidateLatLng, name: '未設定地点' });
				}
			});
		}
	});
}

function escapeHtml(s){
	return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Password-protected initialization
const AUTH_PASSWORD = 'iml2026';

function initPasswordAuth(){
	const modal = document.getElementById('password-modal');
	const pwdInput = document.getElementById('password-input');
	const pwdSubmit = document.getElementById('password-submit');
	const pwdError = document.getElementById('password-error');

	function setError(msg){ pwdError.textContent = msg; showMessage(msg, true); }
	function clearError(){ pwdError.textContent = ''; clearMessage(); }

	function unlock(){
		try { sessionStorage.setItem('driveria_auth_ok','1'); } catch(e) {}
		if (modal) modal.style.display = 'none';
		clearError();
		loadGoogleMapsApi().then(() => { initApp(); }).catch(err => { showMessage(err.message || 'API読み込み失敗', true); console.error(err); });
	}

	pwdSubmit.addEventListener('click', () => {
		const v = pwdInput.value || '';
		if (v === AUTH_PASSWORD) { unlock(); }
		else { setError('パスワードが無効です。'); }
	});

	pwdInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') pwdSubmit.click(); });

	// 既にセッション認証があればスキップ
	try{
		if (sessionStorage.getItem('driveria_auth_ok') === '1'){
			if (modal) modal.style.display = 'none';
			loadGoogleMapsApi().then(() => { initApp(); }).catch(err => { showMessage(err.message || 'API読み込み失敗', true); console.error(err); });
			return;
		}
	}catch(e){ /* ignore */ }

	if (modal){ modal.style.display = 'flex'; if (pwdInput) pwdInput.focus(); }
}

initPasswordAuth();

