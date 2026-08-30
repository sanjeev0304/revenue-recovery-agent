export interface OutboundMessage {
  paymentId: string
  customerId: string
  body: string
  includeLink: boolean
  link: string | null
  sentAt: Date
}

export interface Channel {
  send(message: OutboundMessage): Promise<{ messageRef: string }>
}

export class MockChannel implements Channel {
  readonly sent: OutboundMessage[] = []

  async send(message: OutboundMessage): Promise<{ messageRef: string }> {
    this.sent.push(message)
    return { messageRef: `mock_msg_${this.sent.length}` }
  }
}
