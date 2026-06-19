package activity

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	defaultBufferSize  = 500
	defaultBatchSize   = 100
	defaultFlushPeriod = 5 * time.Second
)

// Logger provides both async (buffered) and sync (transactional) logging.
type Logger struct {
	repo   *Repository
	buffer chan Log
	wg     sync.WaitGroup
	stopCh chan struct{}
	once   sync.Once
}

// NewLogger creates and starts the async background writer.
func NewLogger(repo *Repository) *Logger {
	l := &Logger{
		repo:   repo,
		buffer: make(chan Log, defaultBufferSize),
		stopCh: make(chan struct{}),
	}
	l.start()
	return l
}

// LogAsync enqueues a log entry for async batch insert.
// Non-blocking: if buffer is full the entry is dropped and an error is logged to stderr.
// Never blocks an API response.
func (l *Logger) LogAsync(entry Entry) {
	logEntry := buildLog(entry)
	select {
	case l.buffer <- logEntry:
		// queued
	default:
		// Buffer full — log to stderr, never block.
		log.Printf("[activity] buffer full, dropping log entry: action=%s entity_type=%s\n",
			entry.Action, entry.EntityType)
	}
}

// LogSync writes a single log entry inside an existing DB transaction.
// Used for compensation changes. Blocks until the write completes.
func (l *Logger) LogSync(tx *gorm.DB, entry Entry) error {
	logEntry := buildLog(entry)
	if err := l.repo.InsertTx(tx, &logEntry); err != nil {
		return fmt.Errorf("sync activity log: %w", err)
	}
	return nil
}

// Shutdown drains the buffer and stops the background goroutine.
// Call during graceful shutdown.
func (l *Logger) Shutdown(ctx context.Context) {
	l.once.Do(func() {
		close(l.stopCh)
	})

	done := make(chan struct{})
	go func() {
		l.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
		log.Println("[activity] shutdown timed out, some logs may be lost")
	}
}

// start launches the background flush goroutine.
func (l *Logger) start() {
	l.wg.Add(1)
	go func() {
		defer l.wg.Done()

		ticker := time.NewTicker(defaultFlushPeriod)
		defer ticker.Stop()

		pending := make([]Log, 0, defaultBatchSize)

		flush := func() {
			if len(pending) == 0 {
				return
			}
			batch := make([]Log, len(pending))
			copy(batch, pending)
			pending = pending[:0]

			if err := l.repo.BatchInsert(context.Background(), batch); err != nil {
				log.Printf("[activity] batch insert error: %v\n", err)
			}
		}

		for {
			select {
			case entry := <-l.buffer:
				pending = append(pending, entry)
				if len(pending) >= defaultBatchSize {
					flush()
				}

			case <-ticker.C:
				flush()

			case <-l.stopCh:
				// Drain remaining entries.
				for {
					select {
					case entry := <-l.buffer:
						pending = append(pending, entry)
					default:
						flush()
						return
					}
				}
			}
		}
	}()
}

// buildLog converts an Entry into a Log model ready for DB insert.
func buildLog(e Entry) Log {
	l := Log{
		ID:         uuid.New(),
		ActorID:    e.ActorID,
		Action:     e.Action,
		EntityType: e.EntityType,
		EntityID:   e.EntityID,
		IPAddress:  e.IPAddress,
		UserAgent:  e.UserAgent,
		Reason:     e.Reason,
	}

	if e.BeforeState != nil {
		if b, err := json.Marshal(e.BeforeState); err == nil {
			l.BeforeState = &b
		}
	}
	if e.AfterState != nil {
		if b, err := json.Marshal(e.AfterState); err == nil {
			l.AfterState = &b
		}
	}

	return l
}
