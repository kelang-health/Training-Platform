window.TRAINING_APP_CONFIG = Object.freeze({
  // วาง URL ของ Public API Deployment ที่ลงท้ายด้วย /exec เท่านั้น
  GAS_API_URL: 'https://script.google.com/macros/s/AKfycbzQ1D4oUbDXJ0migUOM9N-bjPuIUlwWzAeMW_sDx5j9IES7vqre14rpMIiF_a-OZeCS/exec',
  REQUEST_TIMEOUT_MS: 30000
});

const query = new URLSearchParams(window.location.search);
const requestedRoute = query.get('page') || 'home';
const allowedRoutes = ['home', 'registration', 'resume', 'pre-test', 'post-test', 'result', 'evaluation', 'certificate', 'verify'];
window.APP_BOOTSTRAP = Object.freeze({
  route: allowedRoutes.includes(requestedRoute) ? requestedRoute : 'home',
  certificateToken: String(query.get('token') || '').slice(0, 300)
});
