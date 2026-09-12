package handlers

import "github.com/gin-gonic/gin"

func NewRouter(h *Handler, allowedOrigin string) *gin.Engine {
	r := gin.Default()
	r.Use(corsMiddleware(allowedOrigin))

	// Chunk bodies can be up to ~50MB; make sure Gin doesn't choke on it.
	r.MaxMultipartMemory = 64 << 20

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	api := r.Group("/api/uploads")
	{
		api.POST("/init", h.InitUpload)
		api.PUT("/:sessionId/parts/:partNumber", h.UploadPart)
		api.GET("/:sessionId/resume", h.ResumeUpload)
		api.POST("/:sessionId/complete", h.CompleteUpload)
		api.POST("/:sessionId/abort", h.AbortUpload)
	}

	return r
}

func corsMiddleware(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, X-Checksum-MD5")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
