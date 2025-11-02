import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MessageSquare, Send, RotateCcw, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Message {
  id: string;
  subject: string;
  from: string;
  body: string;
  createdAt: string;
  read: boolean;
}

interface ReturnCase {
  id: string;
  orderId: string;
  itemTitle: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  refundAmount: number;
  createdAt: string;
}

export default function MessagesPage() {
  const { toast } = useToast();
  const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data: messages, isLoading: messagesLoading } = useQuery<Message[]>({
    queryKey: ["/api/messages"],
  });

  const { data: returnCases, isLoading: returnsLoading } = useQuery<ReturnCase[]>({
    queryKey: ["/api/returns"],
  });

  const replyMutation = useMutation({
    mutationFn: async ({ messageId, reply }: { messageId: string; reply: string }) => {
      return apiRequest("POST", "/api/messages/reply", { messageId, reply });
    },
    onSuccess: () => {
      toast({
        title: "Reply sent",
        description: "Your message has been sent to the buyer",
      });
      setReplyText("");
      setSelectedMessage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/messages"] });
    },
  });

  const handleReturnAction = useMutation({
    mutationFn: async ({ caseId, action }: { caseId: string; action: "approve" | "reject" }) => {
      return apiRequest("POST", "/api/returns/action", { caseId, action });
    },
    onSuccess: () => {
      toast({
        title: "Return case updated",
        description: "The return case has been processed",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
    },
  });

  const selectedMsg = messages?.find((m) => m.id === selectedMessage);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-page-title">Messages & Returns</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage buyer communications and return cases</p>
        </div>

        <Tabs defaultValue="messages" className="space-y-6">
          <TabsList>
            <TabsTrigger value="messages" data-testid="tab-messages">
              <MessageSquare className="w-4 h-4 mr-2" />
              Messages
              {messages && messages.filter((m) => !m.read).length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1">
                  {messages.filter((m) => !m.read).length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="returns" data-testid="tab-returns">
              <RotateCcw className="w-4 h-4 mr-2" />
              Returns
              {returnCases && returnCases.filter((c) => c.status === "pending").length > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 min-w-5 px-1">
                  {returnCases.filter((c) => c.status === "pending").length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Messages List */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Inbox</CardTitle>
                </CardHeader>
                <CardContent>
                  {messagesLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : messages && messages.length > 0 ? (
                    <div className="space-y-2">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            selectedMessage === msg.id
                              ? "border-primary bg-accent"
                              : "border-border hover-elevate"
                          }`}
                          onClick={() => setSelectedMessage(msg.id)}
                          data-testid={`message-${msg.id}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="font-medium text-sm flex-1 line-clamp-1">{msg.subject}</div>
                            {!msg.read && (
                              <div className="h-2 w-2 rounded-full bg-chart-2 flex-shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mb-1">From: {msg.from}</div>
                          <div className="text-sm text-muted-foreground line-clamp-2">{msg.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No messages</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Message Detail & Reply */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">
                    {selectedMsg ? "Reply" : "Select a message"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selectedMsg ? (
                    <>
                      <div className="space-y-3 pb-4 border-b">
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Subject</div>
                          <div className="font-medium" data-testid="text-message-subject">{selectedMsg.subject}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">From</div>
                          <div className="font-mono text-sm" data-testid="text-message-from">{selectedMsg.from}</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">Message</div>
                          <div className="text-sm whitespace-pre-wrap" data-testid="text-message-body">{selectedMsg.body}</div>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="text-sm font-medium">Your Reply</div>
                        <Textarea
                          placeholder="Type your response..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          className="min-h-[120px]"
                          data-testid="textarea-reply"
                        />
                        <div className="flex gap-2">
                          <Button
                            onClick={() => replyMutation.mutate({ messageId: selectedMsg.id, reply: replyText })}
                            disabled={!replyText.trim() || replyMutation.isPending}
                            data-testid="button-send-reply"
                          >
                            <Send className="w-4 h-4 mr-2" />
                            Send Reply
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setReplyText("Thank you for contacting us. We'll look into this right away and get back to you shortly.")}
                            data-testid="button-canned-response"
                          >
                            Use Template
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <p>Select a message to view and reply</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="returns" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Return Cases</CardTitle>
              </CardHeader>
              <CardContent>
                {returnsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-full" />
                    ))}
                  </div>
                ) : returnCases && returnCases.length > 0 ? (
                  <div className="space-y-4">
                    {returnCases.map((returnCase) => (
                      <Card key={returnCase.id} data-testid={`return-case-${returnCase.id}`}>
                        <CardContent className="p-6">
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium">{returnCase.itemTitle}</h4>
                                <Badge
                                  variant={
                                    returnCase.status === "approved"
                                      ? "default"
                                      : returnCase.status === "rejected"
                                      ? "destructive"
                                      : "outline"
                                  }
                                  data-testid={`badge-return-status-${returnCase.id}`}
                                >
                                  {returnCase.status}
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <div>Reason: {returnCase.reason}</div>
                                <div>Refund: ${(returnCase.refundAmount / 100).toFixed(2)}</div>
                                <div>Opened: {new Date(returnCase.createdAt).toLocaleDateString()}</div>
                              </div>
                            </div>
                            {returnCase.status === "pending" && (
                              <div className="flex gap-2">
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={() => handleReturnAction.mutate({ caseId: returnCase.id, action: "approve" })}
                                  disabled={handleReturnAction.isPending}
                                  data-testid={`button-approve-return-${returnCase.id}`}
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Approve
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleReturnAction.mutate({ caseId: returnCase.id, action: "reject" })}
                                  disabled={handleReturnAction.isPending}
                                  data-testid={`button-reject-return-${returnCase.id}`}
                                >
                                  <XCircle className="w-4 h-4 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <RotateCcw className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No return cases</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
