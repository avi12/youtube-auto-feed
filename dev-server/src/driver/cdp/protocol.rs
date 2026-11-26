//! The typed shape of CDP messages: the commands a session sends and the frames it reads back.
//! Chrome sends more than is read here, so unknown fields are ignored.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

/// The CDP commands sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Method {
    /// Evaluates an expression.
    #[serde(rename = "Runtime.evaluate")]
    RuntimeEvaluate,
}

/// The parameters of `Runtime.evaluate`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateParams<'request> {
    expression: &'request str,
    #[serde(rename = "awaitPromise")]
    is_awaiting_promise: bool,
    #[serde(rename = "returnByValue")]
    should_return_by_value: bool,
}

impl<'request> EvaluateParams<'request> {
    /// Evaluates in the page's own context, awaiting a promise and returning its value.
    pub const fn awaited(expression: &'request str) -> Self {
        Self {
            expression,
            is_awaiting_promise: true,
            should_return_by_value: true,
        }
    }
}

#[derive(Serialize)]
struct Command<'request, P> {
    id: u64,
    method: Method,
    #[serde(rename = "params")]
    parameters: &'request P,
}

/// The message text of one command.
pub fn encode_command<P: Serialize>(id: u64, method: Method, parameters: &P) -> Result<String> {
    Ok(serde_json::to_string(&Command {
        id,
        method,
        parameters,
    })?)
}

/// One message from a target: the reply to a command (`id`) or an event (no `id`).
#[derive(Debug, Deserialize)]
pub struct Incoming {
    /// The command this answers.
    pub id: Option<u64>,
    /// The command's result.
    pub result: Option<Value>,
    /// Why the command failed.
    pub error: Option<Value>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::driver::cdp::protocol::*;

    #[test]
    fn commands_keep_their_wire_shape() -> Result<()> {
        let sent = encode_command(2, Method::RuntimeEvaluate, &EvaluateParams::awaited("1"))?;
        let expected = json!({"id":2,"method":"Runtime.evaluate",
            "params":{"expression":"1","awaitPromise":true,"returnByValue":true}});
        assert_eq!(serde_json::from_str::<Value>(&sent)?, expected);
        Ok(())
    }

    #[test]
    fn replies_parse_with_unknown_fields() -> Result<()> {
        let reply: Incoming = serde_json::from_str(r#"{"id":4,"result":{},"sessionId":"s"}"#)?;
        assert_eq!(reply.id, Some(4));
        Ok(())
    }
}
