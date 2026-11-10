CREATE VIRTUAL TABLE `corpus_search` USING fts5(`search_text`, content='corpus_articles', content_rowid='rowid', tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER `corpus_articles_ai` AFTER INSERT ON `corpus_articles` BEGIN
  INSERT INTO `corpus_search` (`rowid`, `search_text`) VALUES (new.rowid, new.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `corpus_articles_ad` AFTER DELETE ON `corpus_articles` BEGIN
  INSERT INTO `corpus_search` (`corpus_search`, `rowid`, `search_text`) VALUES ('delete', old.rowid, old.search_text);
END;
--> statement-breakpoint
CREATE TRIGGER `corpus_articles_au` AFTER UPDATE ON `corpus_articles` BEGIN
  INSERT INTO `corpus_search` (`corpus_search`, `rowid`, `search_text`) VALUES ('delete', old.rowid, old.search_text);
  INSERT INTO `corpus_search` (`rowid`, `search_text`) VALUES (new.rowid, new.search_text);
END;
