<?php defined('BASEPATH') or exit('No direct script access allowed');

/**
 * Chatbot Controller — SOFIA Viber Bot
 * Integrated with Mnemosyne RAG Server (authenticated via API Key)
 */
class Chatbot extends CI_Controller
{
    private $default_buttons = [];

    // ── RAG configuration ──────────────────────────────────────────
    private $rag_base_url;
    private $rag_api_key;
    private $rag_timeout = 30;
    private $rag_top_k   = 5;

    public function __construct()
    {
        parent::__construct();
        $this->load->library('viber');
        $this->load->model('Abas');

        // RAG server URL — set in config/constants.php or environment
        $this->rag_base_url = defined('RAG_SERVER_URL')
            ? RAG_SERVER_URL
            : (getenv('RAG_SERVER_URL') ?: 'http://localhost:3001');

        // API key — NEVER hardcode here; always use config or environment
        $this->rag_api_key = defined('RAG_API_KEY')
            ? RAG_API_KEY
            : getenv('RAG_API_KEY');

        if (empty($this->rag_api_key)) {
            log_message('error', 'RAG_API_KEY is not configured. Chatbot RAG queries will fail.');
        }

        $this->default_buttons = [
            $this->viber->createButton('reply', 'view vessels', 'View Vessels'),
            $this->viber->createButton('reply', 'view trucks',  'View Trucks'),
            $this->viber->createButton('reply', 'ask mnemosyne',    'Ask Mnemosyne 🤖'),
            $this->viber->createButton('reply', 'get location', 'Get Location'),
        ];
    }

    // ──────────────────────────────────────────────────────────────
    //  Webhook
    // ──────────────────────────────────────────────────────────────
    public function index()
    {
        $response = json_decode(file_get_contents('php://input'), true);

        if (!$response) {
            header('Content-Type: application/json');
            http_response_code(200);
            echo json_encode(['message' => 'Welcome to Mnemosyne Chatbot!', 'status' => 'ok']);
            exit;
        }

        if ($response['event'] === 'conversation_started') {
            $msg = "👋 Hi! Welcome to AV Chatbot.\n\n"
                 . "I'm SOFIA, your AI assistant. "
                 . "powered by an RAG knowledge base of your ERP system.\n\n"
                 . "Select an option or just type your question:";
            $this->viber->sendMessage($response['user']['id'], $msg, $this->default_buttons);
            exit;
        }

        if ($response['event'] === 'message') {
            $received_msg    = trim($response['message']['text'] ?? '');
            $sender_id       = $response['sender']['id'];
            $sender_name     = $response['sender']['name'];
            $sender_location = $response['message']['location'] ?? [];
            $msg_lower       = strtolower($received_msg);

            $menu  = [];
            $reply = '';

            switch (true) {
                case in_array($msg_lower, ['hi', 'hello', 'hey']):
                    $reply = "Hello {$sender_name}! 👋 What can I help you with?";
                    $menu  = $this->default_buttons;
                    break;

                case $msg_lower === 'ask bot':
                    $reply = "🤖 SOFIA is ready! Type any question about the knowledge base.\n\nExamples:\n• How do I create a purchase order?\n• What vessels are in the system?\n• How does truck dispatching work?";
                    break;

                case $msg_lower === 'view vessels':
                    $reply = $this->_ragQuery('List all vessels tracked in the the system with their key details.', $sender_id);
                    $menu  = $this->default_buttons;
                    break;

                case $msg_lower === 'view trucks':
                    $reply = $this->_ragQuery('List all trucks tracked in the the system with their key details.', $sender_id);
                    $menu  = $this->default_buttons;
                    break;

                case $msg_lower === 'get location':
                    $menu  = [
                        $this->viber->createButton('location-picker', 'send location', 'Send Current Location 📍'),
                        $this->viber->createButton('reply', 'back', '← Back'),
                    ];
                    $reply = "Please pin your marker on the map.";
                    break;

                case $msg_lower === 'send location':
                    if (empty($sender_location['lat'])) {
                        $reply = "⚠️ Coordinates not found. Either you didn't select the marker or you're on Viber desktop.";
                    } else {
                        $reply = "📍 Your location:\nLat: {$sender_location['lat']}\nLon: {$sender_location['lon']}";
                    }
                    $menu = $this->default_buttons;
                    break;

                case stripos($received_msg, 'avega') !== false:
                    $reply = "Viva Pit Señor! 🙏";
                    $menu  = $this->default_buttons;
                    break;

                case in_array($msg_lower, ['back', 'cancel', 'menu']):
                    $reply = "Here's the main menu:";
                    $menu  = $this->default_buttons;
                    break;

                default:
                    if (str_word_count($received_msg) >= 2 || strpos($received_msg, '?') !== false) {
                        $reply = $this->_ragQuery($received_msg, $sender_id);
                        $menu  = [
                            $this->viber->createButton('reply', 'ask mnemosyne', '🤖 Ask Another'),
                            $this->viber->createButton('reply', 'menu',      '← Main Menu'),
                        ];
                    } else {
                        $reply = "Please select an option or ask me a question.";
                        $menu  = $this->default_buttons;
                    }
                    break;
            }

            $this->viber->sendMessage($sender_id, $reply, $menu);
            exit;
        }
    }

    // ──────────────────────────────────────────────────────────────
    //  RAG Query — authenticated with X-API-Key header
    // ──────────────────────────────────────────────────────────────

    /**
     * Send a query to the RAG server.
     * The X-API-Key header is injected on every request.
     *
     * @param  string $query
     * @param  string $sender_id  Used as sessionId hint for caching
     * @return string  Plain-text answer safe for Viber
     */
    private function _ragQuery(string $query, string $sender_id = ''): string
    {
        if (empty($this->rag_api_key)) {
            log_message('error', 'RAG query skipped: RAG_API_KEY not configured');
            return "⚠️ Mnemosyne is not configured. Please contact your administrator.";
        }

        $endpoint = rtrim($this->rag_base_url, '/') . '/api/query';

        $payload = json_encode([
            'query'   => $query,
            'options' => [
                'topK'      => $this->rag_top_k,
                'sessionId' => $sender_id,
            ],
        ]);

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->rag_timeout,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Content-Length: ' . strlen($payload),
                // ← API key authentication
                'X-API-Key: ' . $this->rag_api_key,
                'X-Client: viber-chatbot',
            ],
        ]);

        $raw      = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr  = curl_error($ch);
        curl_close($ch);

        if ($curlErr) {
            log_message('error', "RAG cURL error: {$curlErr}");
            return "⚠️ Mnemosyne is temporarily unavailable. Please try again later.";
        }

        switch ($httpCode) {
            case 401:
                log_message('error', "RAG auth failed (401) — check RAG_API_KEY in CI config");
                return "⚠️ Mnemosyne authentication failed. Please contact your administrator.";
            case 403:
                log_message('error', "RAG forbidden (403) — invalid API key");
                return "⚠️ Mnemosyne access denied. Please contact your administrator.";
            case 429:
                return "⏳ Mnemosyne is handling many requests right now. Please wait a moment and try again.";
            case 500:
            case 502:
            case 503:
                log_message('error', "RAG server error {$httpCode}: {$raw}");
                return "⚠️ Mnemosyne encountered an error. Please try again.";
        }

        $data = json_decode($raw, true);

        if (!$data || empty($data['answer'])) {
            log_message('error', "RAG empty/invalid response (HTTP {$httpCode}): {$raw}");
            return "🤔 Mnemosyne couldn't find an answer to that. Please rephrase or contact your administrator.";
        }

        $answer = $data['answer'];

        // Append source filenames if multiple documents were used
        if (!empty($data['sources']) && count($data['sources']) > 1) {
            $names  = array_unique(array_column($data['sources'], 'filename'));
            $answer .= "\n\n📚 Sources: " . implode(', ', array_slice($names, 0, 3));
        }

        if (!empty($data['fromCache'])) {
            log_message('debug', "RAG cache hit for: {$query}");
        }

        return $this->_sanitizeForViber($answer);
    }

    /**
     * Strip markdown and truncate to Viber's safe length
     */
    private function _sanitizeForViber(string $text, int $limit = 900): string
    {
        $text = preg_replace('/#{1,6}\s/',     '',    $text);
        $text = preg_replace('/\*\*(.*?)\*\*/', '$1', $text);
        $text = preg_replace('/\*(.*?)\*/',     '$1', $text);
        $text = preg_replace('/`{1,3}[^`]*`{1,3}/', '', $text);
        $text = trim($text);

        return mb_strlen($text) <= $limit ? $text : mb_substr($text, 0, $limit - 1) . '…';
    }

    // ──────────────────────────────────────────────────────────────
    //  Webhook management & utilities
    // ──────────────────────────────────────────────────────────────
    public function webhook($action)
    {
        if ($action === 'set') {
            $r = $this->viber->setWebhook();
            echo json_encode($r['status'] == 0
                ? ['message' => 'Webhook set.', 'status' => 'ok']
                : ['message' => 'Webhook set failed.', 'status' => 'fail']);
        } elseif ($action === 'unset') {
            $r = $this->viber->unsetWebhook();
            echo json_encode($r['status'] == 0
                ? ['message' => 'Webhook unset.', 'status' => 'ok']
                : ['message' => 'Webhook unset failed.', 'status' => 'fail']);
        } else {
            echo json_encode(['message' => 'Use "set" or "unset"', 'status' => 'fail']);
        }
        exit;
    }

    public function broadcast_message()
    {
        $message  = $this->Abas->sanitize($_POST['message']);
        $response = $this->viber->broadcastMessage($message);
        echo json_encode($response['status'] == '0'
            ? ['message' => 'Broadcast sent.', 'status' => 'ok']
            : ['message' => 'Broadcast failed.', 'status' => 'fail']);
        exit;
    }

    public function get_user()
    {
        $user_id  = $this->Abas->sanitize($_POST['user_id']);
        $response = $this->viber->getUserDetails($user_id);
        echo json_encode($response['status'] == '0'
            ? ['data' => $response, 'status' => 'ok']
            : ['message' => 'Failed.', 'status' => 'fail']);
        exit;
    }

    public function get_chatbot_info()
    {
        $response = $this->viber->getAccountInfo();
        echo json_encode($response['status'] == '0'
            ? ['data' => $response, 'status' => 'ok']
            : ['message' => 'Failed.', 'status' => 'fail']);
        exit;
    }

    public function get_online_users()
    {
        print_r($this->viber->getWhosOnline());
    }

    /**
     * GET /chatbot/rag_status
     * Quick health check — confirms API key is working
     */
    public function rag_status()
    {
        $endpoint = rtrim($this->rag_base_url, '/') . '/health';
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        $raw  = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        // Also verify the API key works on a protected endpoint
        $verify_endpoint = rtrim($this->rag_base_url, '/') . '/api/auth/verify';
        $ch2 = curl_init($verify_endpoint);
        curl_setopt_array($ch2, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_HTTPHEADER     => ['X-API-Key: ' . $this->rag_api_key],
        ]);
        $verify_raw  = curl_exec($ch2);
        $verify_code = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
        curl_close($ch2);

        header('Content-Type: application/json');
        echo json_encode([
            'rag_server'    => $code === 200 ? 'online' : 'offline',
            'rag_url'       => $this->rag_base_url,
            'api_key_valid' => $verify_code !== 403 && $verify_code !== 401,
            'api_key_set'   => !empty($this->rag_api_key),
        ]);
        exit;
    }
}
