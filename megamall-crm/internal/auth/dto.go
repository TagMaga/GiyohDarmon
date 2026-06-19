package auth

// LoginRequest is the payload for POST /auth/login.
type LoginRequest struct {
	Phone    string `json:"phone"    validate:"required"`
	Password string `json:"password" validate:"required"`
}

// RefreshRequest is the payload for POST /auth/refresh.
type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" validate:"required"`
}

// TokenPairResponse is returned on successful login or refresh.
type TokenPairResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"` // seconds until access token expires
}
