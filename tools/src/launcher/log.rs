//! The log line format of the dev server, `[2:05:33 PM] message`, for its own lines and for the
//! `tracing` events the hot loop library emits.

use std::fmt::{self, Debug, Write};

use jiff::Zoned;
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, Layer, SubscriberExt};

use crate::error::{Error, Result};

const MESSAGE_FIELD: &str = "message";

/// Prints one timestamped line.
pub(crate) fn log_event(message: &str) {
    println!("[{}] {message}", Zoned::now().strftime("%-I:%M:%S %p"));
}

#[derive(Default)]
struct MessageVisitor {
    text: String,
}

impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
        let is_message = field.name() == MESSAGE_FIELD;
        if is_message {
            // Writing into a String cannot fail
            let _ = write!(self.text, "{value:?}");
        }
    }
}

impl fmt::Display for MessageVisitor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.text)
    }
}

struct PrintLayer;

impl<S: Subscriber> Layer<S> for PrintLayer {
    fn on_event(&self, event: &Event<'_>, _context: Context<'_, S>) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        let level = *event.metadata().level();
        let is_warning_or_worse = level <= Level::WARN;
        if is_warning_or_worse {
            log_event(&format!("{level} {visitor}"));
            return;
        }
        log_event(&visitor.to_string());
    }
}

/// Routes the library's `tracing` events through [`log_event`].
pub(super) fn install_log_layer() -> Result<()> {
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(PrintLayer))
        .map_err(|error| Error::Logging(error.to_string()))
}
